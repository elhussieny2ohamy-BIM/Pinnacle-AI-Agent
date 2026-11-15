/**
 * Module supervisor: owns the MCP registrations the hub adds for a profile,
 * gates them on whether their host application is running, and reports one of
 * the settled states `disabled`, `app_not_running`, `connected`, or `error`.
 * `starting` is the transient between registration and the first connection
 * result.
 *
 * Every registration is released through its disposer when the module is
 * disabled, its application disappears, or the supervisor stops, so a
 * long-running dsh process never accumulates orphaned MCP children.
 * @module @pinnacle/mcp-hub/src/supervisor
 */

import { errorMessage } from './message.ts'
import type { ModuleState, ModuleStatus, ProbeOutcome, ServerEntry } from './types.ts'

/** Raised when a command or the page names a module the supervisor does not track. */
export class SupervisorError extends Error {
  /** @param message - an actionable description naming the unknown module. */
  constructor(message: string) {
    super(message)
    this.name = 'SupervisorError'
  }
}

/** The close result shared by manager statuses and probe outcomes. */
export interface CloseResult {
  readonly closeConfirmed: boolean
  readonly cleanupError?: string
}

/**
 * One status as `mcp-manager/status` publishes it. This mirrors the manager's
 * closed union; unknown members fall through to an explicit error report so a
 * newer manager cannot silently leave a module unclassified.
 */
export type ManagerStatus =
  | { state: 'closed'; result: CloseResult }
  | { state: 'waiting-credentials'; lastError: string }
  | { state: 'connecting'; attempt: number }
  | { state: 'connected'; toolCount: number; connectedAt: number }
  | { state: 'reconnecting'; attempt: number; maxAttempts: number; nextRetryAtMs: number; lastError: string }
  | { state: 'failed'; reason: string; lastError?: string }
  | { state: 'failed'; reason: 'cleanup'; result: CloseResult }
  | { state: 'disabled' }

/** Outcome of `mcp-manager.probe`, reduced to the fields the hub reports. */
export type ManagerProbeResult =
  | {
    readonly ok: true
    readonly toolNames: readonly string[]
    readonly truncated: boolean
    readonly durationMs: number
    readonly closeConfirmed: boolean
    readonly cleanupError?: string
  }
  | {
    readonly ok: false
    readonly stage: 'connect' | 'list'
    readonly message: string
    readonly durationMs: number
    readonly closeConfirmed: boolean
    readonly cleanupError?: string
  }

/** The manager operations the supervisor needs; the real service satisfies this structurally. */
export interface ManagerPort {
  /**
   * Register one server for the caller's lifetime.
   * @param name - server key, also the module id.
   * @param entry - the MCP entry the manager validates and mounts.
   * @returns an idempotent disposer.
   */
  register(name: string, entry: ServerEntry): () => void
  /**
   * Probe without touching the live instance.
   * @param name - a configured or registered server key.
   * @param options - abort signal forwarded to the transport.
   * @returns the stage-classified probe result.
   */
  probe?(name: string, options?: { signal?: AbortSignal }): Promise<ManagerProbeResult>
}

/** Process lookup used by the app gate. */
export interface AppGate {
  /**
   * List which of the requested processes are running.
   * @param names - process names from every enabled gated module, one query per tick.
   * @returns the subset that is running; names may carry or omit `.exe`.
   */
  running(names: readonly string[]): Promise<ReadonlySet<string>>
}

/** One module handed to the supervisor. */
export interface ModuleSpec {
  /** Stable module id; also the manager server key. */
  readonly id: string
  /** Display name used by the page and commands. */
  readonly title: string
  /** Whether the hub currently wants this module mounted. */
  readonly enabled: boolean
  /** Whether the host application must be running first. */
  readonly requiresApp: boolean
  /** Process names that prove the host application is running. */
  readonly processNames: readonly string[]
  /** The MCP entry registered with the manager. */
  readonly entry: ServerEntry
  /** Discovery hints used to locate the server and host application. */
  readonly discovery?: {
    readonly serverPaths?: readonly string[]
    readonly appPaths?: readonly string[]
    readonly unsupported?: boolean
  }
}

/** Timer operations, injectable so tests never depend on wall-clock polling. */
export interface SupervisorTimers {
  setInterval(callback: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** Construction options for {@link Supervisor}. */
export interface SupervisorOptions {
  /** Modules in pack declaration order. */
  readonly modules: readonly ModuleSpec[]
  /** The MCP manager, when it is already loaded. */
  readonly manager?: ManagerPort
  /** Process lookup; absent means gated modules cannot start. */
  readonly appGate?: AppGate
  /** Interval between process scans. */
  readonly pollMs: number
  /** Default probe budget when the entry does not declare `startupTimeoutMs`. */
  readonly probeTimeoutMs?: number
  /** Clock used for `since` and reconnect waits. */
  readonly now?: () => number
  /** Timer implementation; defaults to Node's. */
  readonly timers?: SupervisorTimers
  /** Called after every state change, for live evidence and the hub page. */
  readonly onTransition?: (status: ModuleStatus) => void
}

/** Mutable per-module runtime state. */
interface Runtime {
  readonly spec: ModuleSpec
  enabled: boolean
  state: ModuleState
  detail: string
  since: string
  appGate: boolean
  appRunning: boolean
  registered: boolean
  dispose: (() => void) | undefined
  probing: boolean
  toolCount: number | undefined
}

/** A pending probe waiting for a terminal manager status. */
interface StatusWait {
  readonly promise: Promise<ProbeOutcome>
  settle(outcome: ProbeOutcome): void
}

/** Default probe budget when neither the command nor the entry supplies one. */
const DEFAULT_PROBE_TIMEOUT_MS = 30_000

/** Remove a directory component and `.exe` so `C:\â€¦\acad.exe` matches `acad`. */
function normalizeProcessName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name
  return base.toLowerCase().replace(/\.exe$/, '')
}

/** Whether any declared process name appears in the scan result. */
function matchesApp(processNames: readonly string[], running: ReadonlySet<string>): boolean {
  if (processNames.length === 0) return false
  const scanned = new Set<string>()
  for (const name of running) scanned.add(normalizeProcessName(name))
  return processNames.some(name => scanned.has(normalizeProcessName(name)))
}

/** Release a Node timer without keeping the process alive for a poll that may never fire. */
function unref(handle: unknown): void {
  if (typeof handle !== 'object' || handle === null || !('unref' in handle)) return
  const candidate = handle as { unref?: () => void }
  if (typeof candidate.unref === 'function') candidate.unref()
}

const DEFAULT_TIMERS: SupervisorTimers = {
  setInterval: (callback, ms) => {
    const handle = setInterval(callback, ms)
    unref(handle)
    return handle
  },
  clearInterval: handle => {
    clearInterval(handle as ReturnType<typeof setInterval>)
  },
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms)
    unref(handle)
    return handle
  },
  clearTimeout: handle => {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

/** Build the human-readable failure detail for a terminal manager status. */
function failureDetail(status: ManagerStatus): string {
  switch (status.state) {
    case 'failed':
      if ('result' in status) {
        return `Cleanup failed after the server stopped${status.result.cleanupError === undefined ? '' : `: ${status.result.cleanupError}`}`
      }
      return `The MCP client stopped retrying (${status.reason})${status.lastError === undefined ? '' : `: ${status.lastError}`}`
    case 'waiting-credentials':
      return `Waiting for credentials: ${status.lastError}`
    case 'closed':
      return `The MCP connection closed${status.result.cleanupError === undefined ? '' : `: ${status.result.cleanupError}`}`
    case 'disabled':
      return 'mcp-manager reports the server disabled although the hub registered it.'
    default:
      return 'The MCP client reported an unexpected failure.'
  }
}

/** Convert one manager status into a probe outcome when it is terminal. */
function probeOutcome(status: ManagerStatus, startedAt: number, now: () => number): ProbeOutcome | undefined {
  const durationMs = Math.max(0, now() - startedAt)
  switch (status.state) {
    case 'connected':
      return { ok: true, stage: 'connect', durationMs, toolCount: status.toolCount }
    case 'failed':
      return { ok: false, stage: 'connect', durationMs, message: failureDetail(status) }
    case 'waiting-credentials':
      return { ok: false, stage: 'connect', durationMs, message: failureDetail(status) }
    case 'closed':
      return { ok: false, stage: 'connect', durationMs, message: failureDetail(status) }
    case 'disabled':
      return { ok: false, stage: 'connect', durationMs, message: failureDetail(status) }
    default:
      return undefined
  }
}

/**
 * One supervisor instance per hub. The class is deliberately independent of
 * Cordis so state transitions, polling, and probe cleanup are unit-testable
 * with fake manager, process, and timer ports.
 */
export class Supervisor {
  private readonly runtimes: Runtime[]
  private readonly byId: Map<string, Runtime>
  private appGate: AppGate | undefined
  private readonly pollMs: number
  private readonly probeTimeoutMs: number
  private readonly now: () => number
  private readonly timers: SupervisorTimers
  private readonly onTransition: ((status: ModuleStatus) => void) | undefined
  /** Probe waiters keyed by module id; each resolves on a terminal status. */
  private readonly probeWaiters = new Map<string, (status: ManagerStatus) => void>()
  private manager: ManagerPort | undefined
  private started = false
  private stopped = false
  private interval: unknown
  private queue: Promise<void> = Promise.resolve()

  /** @param options - modules plus the ports the host wires to real services. */
  constructor(options: SupervisorOptions) {
    if (!Number.isInteger(options.pollMs) || options.pollMs <= 0) {
      throw new SupervisorError(`pinnacle-mcp-hub: pollMs must be a positive integer, got ${String(options.pollMs)}`)
    }
    const now = options.now ?? Date.now
    this.appGate = options.appGate
    this.pollMs = options.pollMs
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
    this.now = now
    this.timers = options.timers ?? DEFAULT_TIMERS
    this.onTransition = options.onTransition
    this.manager = options.manager
    this.runtimes = options.modules.map(spec => ({
      spec,
      enabled: spec.enabled,
      state: 'disabled',
      detail: 'The supervisor has not started.',
      since: new Date(now()).toISOString(),
      appGate: spec.requiresApp && spec.processNames.length > 0,
      appRunning: false,
      registered: false,
      dispose: undefined,
      probing: false,
      toolCount: undefined,
    }))
    this.byId = new Map(this.runtimes.map(runtime => [runtime.spec.id, runtime]))
  }

  /** Replace the manager port, typically when the service finishes loading. */
  attachManager(manager: ManagerPort): void {
    if (this.stopped) return
    this.manager = manager
    void this.refresh()
  }

  /** Attach the process gate, typically when discovery supplies process names. */
  attachAppGate(appGate: AppGate): void {
    if (this.stopped) return
    this.appGate = appGate
    void this.refresh()
  }

  /** Start supervision: one initial scan, then polling while a gate is enabled. */
  async start(): Promise<void> {
    if (this.stopped) throw new SupervisorError('pinnacle-mcp-hub: the supervisor is disposed')
    if (this.started) return
    this.started = true
    await this.refresh()
  }

  /**
   * Re-scan the app gate and reconcile registrations.
   * @returns a promise settling after this pass, serialized behind earlier passes.
   */
  refresh(): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (!this.started || this.stopped) return
      await this.reconcile()
      this.updateTimer()
    }, () => undefined)
    return this.queue
  }

  /**
   * Apply one manager status. Probe registrations consume the status before it
   * can change the module's supervised state.
   * @param name - the module id the status belongs to.
   * @param status - the manager's current status.
   */
  handleStatus(name: string, status: ManagerStatus): void {
    if (this.stopped) return
    const runtime = this.byId.get(name)
    if (runtime === undefined) return
    if (runtime.registered) this.applyStatus(runtime, status)
    const waiter = this.probeWaiters.get(name)
    if (waiter !== undefined) waiter(status)
  }

  /**
   * Enable or disable one module and reconcile immediately.
   * @param id - the module id.
   * @param enabled - whether the hub should keep it mounted.
   * @returns the module's state after reconciliation.
   */
  async setEnabled(id: string, enabled: boolean): Promise<ModuleStatus> {
    const runtime = this.require(id)
    if (runtime.enabled !== enabled) {
      runtime.enabled = enabled
      if (!enabled) {
        const failure = this.unregister(runtime)
        this.transition(runtime, failure === undefined ? 'disabled' : 'error', failure ?? 'Disabled in the hub configuration.')
      }
    }
    await this.refresh()
    return this.statusOf(runtime)
  }

  /**
   * Probe one module. A live registration is tested through the manager's
   * non-disruptive probe; a dormant module is registered temporarily and
   * released after the outcome.
   * @param id - the module id.
   * @param options - override the probe budget or abort it.
   * @returns the probe outcome; never throws for a failed probe.
   */
  async probe(id: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ProbeOutcome> {
    const runtime = this.require(id)
    if (this.probeWaiters.has(id)) {
      return { ok: false, stage: 'register', durationMs: 0, message: 'a probe for this module is already running' }
    }
    if (this.manager === undefined) {
      return { ok: false, stage: 'register', durationMs: 0, message: 'mcp-manager is not loaded in this dsh process' }
    }
    const timeoutMs = options.timeoutMs ?? runtime.spec.entry.startupTimeoutMs ?? this.probeTimeoutMs
    if (runtime.registered) return this.probeRegistered(runtime, timeoutMs, options.signal)
    return this.probeTemporary(runtime, timeoutMs, options.signal)
  }

  /** Release every registration and stop polling. Idempotent. */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.interval !== undefined) {
      this.timers.clearInterval(this.interval)
      this.interval = undefined
    }
    for (const runtime of this.runtimes) {
      this.unregister(runtime)
      runtime.state = 'disabled'
      runtime.detail = 'The hub stopped.'
      runtime.since = new Date(this.now()).toISOString()
    }
    this.probeWaiters.clear()
  }

  /** @returns a detached snapshot in pack declaration order. */
  snapshot(): readonly ModuleStatus[] {
    return this.runtimes.map(runtime => this.statusOf(runtime))
  }

  /** Test and diagnostics hook: whether a poll timer is currently armed. */
  polling(): boolean {
    return this.interval !== undefined
  }

  /** One gate-on pass: one process query for every enabled gated module. */
  private async reconcile(): Promise<void> {
    const requested = new Set<string>()
    for (const runtime of this.runtimes) {
      if (!this.gateOn(runtime)) continue
      for (const name of runtime.spec.processNames) requested.add(name)
    }
    let running = new Set<string>()
    let scanError: string | undefined
    if (requested.size > 0) {
      if (this.appGate === undefined) {
        scanError = 'process detection is unavailable'
      } else {
        try {
          running = new Set(await this.appGate.running([...requested]))
        } catch (error) {
          scanError = `the process scan failed: ${errorMessage(error)}`
        }
      }
    }

    for (const runtime of this.runtimes) {
      runtime.appGate = this.gateOn(runtime)
      runtime.appRunning = runtime.appGate && scanError === undefined
        ? matchesApp(runtime.spec.processNames, running)
        : false

      if (!runtime.enabled) {
        const failure = this.unregister(runtime)
        this.transition(runtime, failure === undefined ? 'disabled' : 'error', failure ?? 'Disabled in the hub configuration.')
        continue
      }
      if (this.manager === undefined) {
        const failure = this.unregister(runtime)
        this.transition(runtime, 'error', failure ?? 'mcp-manager is not loaded in this dsh process.')
        continue
      }
      if (runtime.probing) continue
      if (runtime.appGate && (scanError !== undefined || !runtime.appRunning)) {
        const failure = this.unregister(runtime)
        if (failure !== undefined) {
          this.transition(runtime, 'error', failure)
          continue
        }
        this.transition(runtime, 'app_not_running', scanError ?? `Waiting for ${runtime.spec.processNames.join(' or ')}.`)
        continue
      }
      if (!runtime.registered) this.register(runtime)
    }
  }

  /** Whether a module has a populated process gate. */
  private gateOn(runtime: Runtime): boolean {
    return runtime.spec.requiresApp && runtime.spec.processNames.length > 0
  }

  /** Mount one module and move it to the transient `starting` state. */
  private register(runtime: Runtime): void {
    if (this.manager === undefined) return
    try {
      runtime.dispose = this.manager.register(runtime.spec.id, runtime.spec.entry)
      runtime.registered = true
      this.transition(runtime, 'starting', 'Registered; waiting for the MCP server to connect.')
    } catch (error) {
      runtime.registered = false
      runtime.dispose = undefined
      this.transition(runtime, 'error', `Cannot register the MCP server: ${errorMessage(error)}`)
    }
  }

  /** Release one registration; returns a failure message when disposal throws. */
  private unregister(runtime: Runtime): string | undefined {
    if (!runtime.registered) return undefined
    const dispose = runtime.dispose
    runtime.registered = false
    runtime.dispose = undefined
    runtime.toolCount = undefined
    try {
      dispose?.()
      return undefined
    } catch (error) {
      return `Disposing the MCP server failed: ${errorMessage(error)}`
    }
  }

  /** Map one manager status onto a settled or transient module state. */
  private applyStatus(runtime: Runtime, status: ManagerStatus): void {
    switch (status.state) {
      case 'connected':
        runtime.toolCount = status.toolCount
        this.transition(runtime, 'connected', `${status.toolCount} tool${status.toolCount === 1 ? '' : 's'} available.`)
        return
      case 'connecting':
        runtime.toolCount = undefined
        this.transition(
          runtime,
          'starting',
          status.attempt === 0 ? 'Connecting to the MCP server.' : `Connecting to the MCP server (attempt ${status.attempt + 1}).`,
        )
        return
      case 'reconnecting':
        runtime.toolCount = undefined
        this.transition(
          runtime,
          'starting',
          `Reconnecting in ${Math.max(0, status.nextRetryAtMs - this.now())} ms`
          + ` (attempt ${status.attempt}/${status.maxAttempts}): ${status.lastError}`,
        )
        return
      case 'waiting-credentials':
      case 'failed':
      case 'closed':
      case 'disabled':
        runtime.toolCount = undefined
        this.transition(runtime, 'error', failureDetail(status))
        return
      default:
        this.transition(runtime, 'error', 'mcp-manager reported an unrecognized status.')
    }
  }

  /** Probe a module that is already mounted; the manager probe leaves it untouched. */
  private async probeRegistered(runtime: Runtime, timeoutMs: number, signal?: AbortSignal): Promise<ProbeOutcome> {
    const manager = this.manager
    if (manager?.probe !== undefined) {
      try {
        const result = await manager.probe(runtime.spec.id, signal === undefined ? undefined : { signal })
        return {
          ok: result.ok,
          stage: result.ok ? 'connect' : result.stage,
          durationMs: result.durationMs,
          ...(result.ok ? { toolCount: result.toolNames.length } : { message: result.message }),
          ...(result.cleanupError === undefined ? {} : { cleanupError: result.cleanupError }),
        }
      } catch (error) {
        return {
          ok: false,
          stage: 'connect',
          durationMs: 0,
          message: `The manager could not probe the live server: ${errorMessage(error)}`,
        }
      }
    }
    if (runtime.toolCount !== undefined) {
      return { ok: true, stage: 'connect', durationMs: 0, toolCount: runtime.toolCount }
    }
    const startedAt = this.now()
    const wait = this.beginWait(runtime.spec.id, startedAt, timeoutMs, signal)
    return wait.promise
  }

  /** Register a dormant module, probe it, then release it. Leaves no registration behind. */
  private async probeTemporary(runtime: Runtime, timeoutMs: number, signal?: AbortSignal): Promise<ProbeOutcome> {
    if (this.manager === undefined) {
      return { ok: false, stage: 'register', durationMs: 0, message: 'mcp-manager is not loaded in this dsh process' }
    }
    const startedAt = this.now()
    const wait = this.beginWait(runtime.spec.id, startedAt, timeoutMs, signal)
    let dispose: (() => void) | undefined
    runtime.probing = true
    runtime.registered = true
    try {
      dispose = this.manager.register(runtime.spec.id, runtime.spec.entry)
      if (this.manager.probe !== undefined) {
        const result = await this.manager.probe(runtime.spec.id, signal === undefined ? undefined : { signal })
        return {
          ok: result.ok,
          stage: result.ok ? 'connect' : result.stage,
          durationMs: result.durationMs,
          ...(result.ok ? { toolCount: result.toolNames.length } : { message: result.message }),
          ...(result.cleanupError === undefined ? {} : { cleanupError: result.cleanupError }),
        }
      }
      return wait.promise
    } catch (error) {
      wait.settle({ ok: false, stage: 'register', durationMs: Math.max(0, this.now() - startedAt), message: errorMessage(error) })
      return wait.promise
    } finally {
      runtime.probing = false
      runtime.registered = false
      runtime.dispose = undefined
      try {
        dispose?.()
      } catch (error) {
        // The probe already produced an outcome; surface cleanup failure through the
        // next reconcile instead of replacing a successful connection report.
        runtime.detail = `Probe cleanup failed: ${errorMessage(error)}`
      }
      if (!runtime.enabled) {
        this.transition(runtime, 'disabled', 'Disabled in the hub configuration.')
      }
      void this.refresh()
    }
  }

  /** Arm one status waiter plus its timeout and abort path. */
  private beginWait(id: string, startedAt: number, timeoutMs: number, signal?: AbortSignal): StatusWait {
    let settle: (outcome: ProbeOutcome) => void = () => undefined
    const promise = new Promise<ProbeOutcome>(resolve => {
      settle = resolve
    })
    let settled = false
    const finish = (outcome: ProbeOutcome): void => {
      if (settled) return
      settled = true
      this.timers.clearTimeout(handle)
      signal?.removeEventListener('abort', onAbort)
      if (this.probeWaiters.get(id) === onStatus) this.probeWaiters.delete(id)
      settle(outcome)
    }
    const onStatus = (status: ManagerStatus): void => {
      const outcome = probeOutcome(status, startedAt, this.now)
      if (outcome !== undefined) finish(outcome)
    }
    const onAbort = (): void => {
      finish({ ok: false, stage: 'timeout', durationMs: Math.max(0, this.now() - startedAt), message: 'the probe was aborted' })
    }
    const handle = this.timers.setTimeout(() => {
      finish({
        ok: false,
        stage: 'timeout',
        durationMs: Math.max(0, this.now() - startedAt),
        message: `the probe timed out after ${timeoutMs} ms`,
      })
    }, timeoutMs)
    this.probeWaiters.set(id, onStatus)
    signal?.addEventListener('abort', onAbort, { once: true })
    return { promise, settle: finish }
  }

  /** Arm or disarm the poll timer from the current set of enabled gated modules. */
  private updateTimer(): void {
    const needed = this.started && !this.stopped && this.runtimes.some(runtime => runtime.enabled && this.gateOn(runtime))
    if (needed && this.interval === undefined) {
      this.interval = this.timers.setInterval(() => {
        void this.refresh()
      }, this.pollMs)
    } else if (!needed && this.interval !== undefined) {
      this.timers.clearInterval(this.interval)
      this.interval = undefined
    }
  }

  /** Publish a state change once and notify the evidence listener. */
  private transition(runtime: Runtime, state: ModuleState, detail: string): void {
    if (runtime.state === state && runtime.detail === detail) return
    runtime.state = state
    runtime.detail = detail
    runtime.since = new Date(this.now()).toISOString()
    const status = this.statusOf(runtime)
    try {
      this.onTransition?.(status)
    } catch {
      // A diagnostic observer must never break supervision or hide the module state.
    }
  }

  /** Detached view of one runtime. */
  private statusOf(runtime: Runtime): ModuleStatus {
    return {
      id: runtime.spec.id,
      title: runtime.spec.title,
      state: runtime.state,
      detail: runtime.detail,
      appGate: runtime.appGate,
      appRunning: runtime.appRunning,
      since: runtime.since,
    }
  }

  /** Resolve a module id or fail with the known ids. */
  private require(id: string): Runtime {
    const runtime = this.byId.get(id)
    if (runtime !== undefined) return runtime
    const known = this.runtimes.map(entry => entry.spec.id).join(', ')
    throw new SupervisorError(
      `pinnacle-mcp-hub: unknown module ${JSON.stringify(id)}; known modules: ${known.length === 0 ? '(none)' : known}`,
    )
  }
}

