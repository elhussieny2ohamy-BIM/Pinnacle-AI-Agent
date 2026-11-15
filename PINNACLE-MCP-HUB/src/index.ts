/**
 * Host entry for the PINNACLE MCP hub. One `cordis.patch.yml` row loads this
 * plugin, which validates its configuration, resolves the configured packs,
 * starts the module supervisor, and publishes the `pinnacleHub` service every
 * later hub feature hangs from (policy, audit, control tool, commands).
 *
 * A second activation in the same process is refused: two hubs would race the
 * same MCP servers, the same policy state, and the same audit files, and the
 * underlying tool registry would report a duplicate-name error that names the
 * server rather than the real cause.
 *
 * @module @pinnacle/mcp-hub
 */

import { existsSync } from 'node:fs'
import { createSystemAppGate } from './app-gate.ts'
import { auditRead, auditWrite } from './audit.ts'
import type { AuditRecord } from './audit.ts'
import {
  auditBackup, createBackupState, freeMegabytes, listSnapshots, pruneSnapshots, resolveBackup,
  serializeByKey, snapshotPath,
} from './backup.ts'
import type { BackupEvent, BackupState, SnapshotInfo } from './backup.ts'
import { classifyTool, parseMcpToolName } from './backup-names.ts'
import pinnacleHubRemote, { REMOTE_SERVICE_KEY } from './remote.ts'
import { takeSnapshot } from './backup-runner.ts'
import type { CallableTool, ToolCatalog } from './backup-runner.ts'
import { discoverModules } from './discovery.ts'
import { generateDoctor } from './doctor.ts'
import { readHubConfig } from './config.ts'
import { errorMessage } from './message.ts'
import { moduleSpecs } from './modules.ts'
import { loadPacks } from './registry.ts'
import { moduleWriteListener, writePolicyListener } from './policy.ts'
import { Supervisor } from './supervisor.ts'
import { aecControlDefinition } from './control.ts'
import type { ToolRegistry } from './control.ts'
import type { ManagerPort, ManagerStatus } from './supervisor.ts'
import type {
  DoctorBackup, DoctorReport, HubBackupConfig, HubConfig, HubStatus, LoadedPack, ModuleStatus, PackModule,
  ProbeOutcome,
} from './types.ts'

/** Service name the hub publishes; also the duplicate-load marker. */
export const HUB_SERVICE = 'pinnacleHub'

/** Plugin name; the Loader shows it in row diagnostics. */
export const name = 'pinnacle-mcp-hub'

/**
 * Declared service edges. The hub deliberately injects nothing in this phase:
 * it must load in profiles without tools, commands, or an approval service so
 * the page and `doctor` can explain the gap instead of the row silently
 * staying pending. `mcp-manager` is attached opportunistically when present.
 */
export const inject = [] as const

/** The remedy appended to every duplicate-activation report. */
const ONE_HUB_REMEDY = 'Keep exactly one pinnacle-mcp-hub row and restart dsh.'

/** The public surface other hub plugins, commands, and the page consume. */
export interface HubService {
  /**
   * Current hub state.
   * @returns a fresh snapshot; callers must not retain it across events.
   */
  status(): HubStatus
  /**
   * Enable or disable one module and wait for the reconciliation pass.
   * @param id - the pack module id.
   * @param enabled - whether the hub should keep the server mounted.
   * @returns the module status after reconciliation.
   */
  setEnabled(id: string, enabled: boolean): Promise<ModuleStatus>
  /**
   * Probe one module without changing its enabled intent.
   * @param id - the pack module id.
   * @param options - probe budget override.
   * @returns the probe outcome; a failed probe is a value, not a throw.
   */
  probe(id: string, options?: { timeoutMs?: number }): Promise<ProbeOutcome>
  /**
   * Full diagnosis of the hub environment and every module.
   * @returns a read-only doctor report.
   */
  doctor(): Promise<DoctorReport>
  /**
   * Last N audit records, newest first.
   * @param limit - maximum number of records to return.
   * @returns audit records.
   */
  audit(limit?: number): Promise<readonly AuditRecord[]>
  /**
   * Retained snapshots across every module, newest first.
   * @returns snapshot files currently on disk.
   */
  backups(): readonly SnapshotInfo[]
}

/** The subset of the Cordis context the hub uses. */
interface HubContext {
  /** Read a service by name, including services provided by other fibers. */
  get(serviceName: string): unknown
  /** Publish a service for this fiber's lifetime. */
  provide(serviceName: string, value: unknown): void
  /** Run a contribution and register its teardown. */
  effect(callback: () => (() => void) | void): () => void
  /** Run a contribution once the named services are available. */
  inject(serviceNames: readonly string[], callback: (ctx: HubContext) => void): unknown
  /** Subscribe to a Cordis event for this fiber's lifetime. */
  on(event: string, listener: (...args: unknown[]) => void): () => void
}

/** Registry surface the hub registers the control tool through. */
type ToolsSurface = ToolRegistry & {
  executable(name: string): CallableTool | undefined
  definitions?(): readonly CallableTool[]
  execute?(input: {
    calls: readonly { type: 'tool-call'; id: string; name: string; arguments: string }[]
    signal: AbortSignal
  }): Promise<{
    results: readonly { result: {
      isError: boolean
      error?: { message: string }
      value?: unknown
    } }[]
  }>
}

/** Raised when the hub is activated twice in one process. */
export class HubLoadError extends Error {
  /** @param message - an actionable description naming the duplicate row. */
  constructor(message: string) {
    super(message)
    this.name = 'HubLoadError'
  }
}

/** Mutable lifecycle state shared with the published service snapshot. */
interface HubLifecycle {
  stopped: boolean
}

/** Dependencies captured by the published service. */
interface ServiceDeps {
  readonly settings: HubConfig
  readonly packs: readonly LoadedPack[]
  readonly supervisor: Supervisor
  readonly appGate: ReturnType<typeof createSystemAppGate>
  readonly startedAt: string
  readonly lifecycle: HubLifecycle
  readonly approvalService: boolean
  readonly backupReport: () => readonly DoctorBackup[]
  readonly appRunning: (moduleId: string) => boolean
}

/** Refuse a second activation when the sibling fiber already published the service. */
function assertNoActiveHub(ctx: HubContext): void {
  if (ctx.get(HUB_SERVICE) !== undefined) {
    throw new HubLoadError(`pinnacle-mcp-hub: the hub is already loaded in this dsh process. ${ONE_HUB_REMEDY}`)
  }
}

/**
 * Publish the service, translating Cordis's duplicate-registration refusal into
 * the hub's own message. A sibling row can pass the pre-check because Cordis
 * registers services at activation, not at apply.
 */
function publishHub(ctx: HubContext, service: HubService): void {
  try {
    ctx.provide(HUB_SERVICE, service)
  } catch (error) {
    throw new HubLoadError(
      `pinnacle-mcp-hub: the hub is already loaded in this dsh process (${errorMessage(error)}). ${ONE_HUB_REMEDY}`,
    )
  }
}

/** Build the service whose snapshot reads the live supervisor. */
function createService(deps: ServiceDeps): HubService {
  const { settings, packs, supervisor, appGate, startedAt, lifecycle, approvalService } = deps
  return {
    status: () => ({
      startedAt,
      config: settings,
      packs,
      modules: supervisor.snapshot(),
      stopped: lifecycle.stopped,
    }),
    setEnabled: (id, enabled) => supervisor.setEnabled(id, enabled),
    probe: (id, options) => supervisor.probe(id, options),
    doctor: async () => {
      const allModules = packs.flatMap(p => p.manifest.modules)
      const discovery = await discoverModules(allModules, appGate)
      const environment: string[] = []
      if (!approvalService) environment.push('No approval service present; write confirm/ask is refused.')
      return generateDoctor(
        packs.map(p => ({ packageName: p.packageName, modules: p.manifest.modules })),
        discovery,
        supervisor.snapshot(),
        approvalService,
        environment,
        deps.backupReport(),
      )
    },
    audit: (limit = 50) => Promise.resolve(auditRead(limit)),
    backups: () => listSnapshots(),
  }
}

/** Normalized failure result returned by the `tools/execute` wrapper. */
interface BackupFailureResult {
  readonly isError: true
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  readonly error: { readonly message: string; readonly info: { readonly name: string; readonly code: string } }
}

/** Build the model-facing failure that refuses a write without a snapshot. */
function backupFailure(moduleId: string, reason: string): BackupFailureResult {
  const message = `Backup before ${moduleId} write failed: ${reason} The write was refused.`
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
    error: { message, info: { name: 'BackupError', code: 'BACKUP_FAILED' } },
  }
}

/** Build `doctor` backup entries from the live registry, policy, and ledger. */
function buildBackupReport(
  modules: readonly PackModule[],
  settings: HubBackupConfig,
  state: BackupState,
  tools: ToolCatalog | undefined,
): DoctorBackup[] {
  return modules.map(module => {
    const capability = resolveBackup(module, settings)
    const last = state.last(module.id)
    const issues: string[] = []
    if (capability.kind === 'unsupported') issues.push(capability.reason)
    if (capability.kind === 'tool') {
      const registered = tools?.executable?.(`mcp__${module.id}__${capability.tool}`) !== undefined
      if (!registered) issues.push(`Backup tool ${capability.tool} is not registered; connect the module before writing.`)
    }
    if (capability.kind === 'file' && !existsSync(capability.source)) {
      issues.push(`Configured document is missing: ${capability.source}`)
    }
    if (last?.status === 'failed') issues.push(`Last snapshot failed: ${last.reason ?? 'unknown error'}`)
    return {
      id: module.id,
      supported: module.backup.supported,
      capability: capability.kind,
      ...(capability.kind === 'tool' ? { tool: capability.tool } : {}),
      ...(last?.status === 'created' ? { lastSnapshotAt: last.at } : {}),
      ...(last?.status === 'failed' && last.reason !== undefined ? { lastError: last.reason } : {}),
      issues,
    }
  })
}

/**
 * Validate configuration, start supervision, and publish the hub service.
 * @param ctx - the owning plugin context.
 * @param config - the `config` mapping of the hub row.
 * @throws {HubLoadError} when a hub is already active in this process.
 * @throws {HubConfigError} when the row is malformed.
 * @throws {PackRegistryError} when a configured pack cannot be resolved.
 */
export async function apply(ctx: HubContext, config: unknown): Promise<void> {
  assertNoActiveHub(ctx)
  const settings = readHubConfig(config)
  const packs = await loadPacks(settings.packs)
  const startedAt = new Date().toISOString()
  const appGate = createSystemAppGate()
  const supervisor = new Supervisor({
    modules: moduleSpecs(packs),
    pollMs: settings.defaults.pollMs,
    appGate,
  })
  const lifecycle: HubLifecycle = { stopped: false }
  const approvalService = ctx.get('user-approval') !== undefined
  const allModules = packs.flatMap(p => p.manifest.modules)
  const modulesById = new Map(allModules.map(module => [module.id, module]))
  const backupState = createBackupState()
  const backupLocks = serializeByKey()
  const lastSnapshotAt = new Map<string, number>()

  const appRunning = (moduleId: string): boolean =>
    supervisor.snapshot().find(module => module.id === moduleId)?.appRunning === true

  const catalog = (): ToolCatalog | undefined => ctx.get('tools') as ToolsSurface | undefined

  const identify = (toolName: string) => {
    const parsed = parseMcpToolName(toolName, modulesById)
    if (parsed === undefined) return undefined
    const module = modulesById.get(parsed.moduleId)
    if (module === undefined) return undefined
    return { moduleId: parsed.moduleId, kind: classifyTool(module, parsed.raw) }
  }

  const service = createService({
    settings,
    packs,
    supervisor,
    appGate,
    startedAt,
    lifecycle,
    approvalService,
    appRunning,
    backupReport: () => buildBackupReport(allModules, settings.backup, backupState, ctx.get('tools') as ToolsSurface | undefined),
  })
  publishHub(ctx, service)
  let controlCallId = 0
  const runControlAction = async (action: 'enable' | 'disable' | 'probe', module: string): Promise<unknown> => {
    const tools = ctx.get('tools') as ToolsSurface | undefined
    if (tools?.execute === undefined) throw new Error('The hub tool execution pipeline is unavailable.')
    const batch = await tools.execute({
      calls: [{
        type: 'tool-call',
        id: `pinnacle-hub-ui-${++controlCallId}`,
        name: 'aec_control',
        arguments: JSON.stringify({ action, module }),
      }],
      signal: new AbortController().signal,
    })
    const result = batch.results[0]?.result
    if (result === undefined) throw new Error('The hub tool execution pipeline returned no result.')
    if (result.isError) throw new Error(result.error?.message ?? 'The hub policy refused this action.')
    return result.value
  }
  const hubRemote = new pinnacleHubRemote(service, runControlAction)
  ctx.provide(REMOTE_SERVICE_KEY, hubRemote)
  ctx.effect(() => () => {
    lifecycle.stopped = true
    supervisor.stop()
  })
  ctx.on('mcp-manager/status', (name, status) => {
    supervisor.handleStatus(String(name), status as ManagerStatus)
  })

  const manager = ctx.get('mcpManager')
  if (manager !== undefined) {
    supervisor.attachManager(manager as ManagerPort)
  } else {
    ctx.inject(['mcpManager'], child => {
      const loaded = child.get('mcpManager')
      if (loaded !== undefined) supervisor.attachManager(loaded as ManagerPort)
    })
  }

  ;(ctx.get('tools') as ToolsSurface | undefined)?.register(aecControlDefinition(service))

  // Policy: `aec_control` actions, then every module's own MCP tools.
  const disposeControlPolicy = ctx.on(
    'tools/pre-execute',
    writePolicyListener(() => service.status(), approvalService) as unknown as (...args: unknown[]) => void,
  )
  ctx.effect(() => disposeControlPolicy)

  const baseModulePolicy = moduleWriteListener(identify, () => service.status(), approvalService)
  const auditedModulePolicy = async (
    exec: { name: string },
    next: () => Promise<unknown>,
  ): Promise<unknown> => {
    const decision = await baseModulePolicy(exec as never, next as never) as {
      readonly kind: string
      readonly reason?: string
    }
    if (decision.kind === 'deny' || decision.kind === 'cancel') {
      const found = identify(exec.name)
      if (found !== undefined) {
        auditWrite({
          ts: new Date().toISOString(),
          module: found.moduleId,
          tool: exec.name,
          decision: 'deny',
          result: 'refused',
          durationMs: 0,
          ...(decision.reason === undefined ? {} : { detail: decision.reason }),
        })
      }
    }
    return decision
  }
  const disposeModulePolicy = ctx.on(
    'tools/pre-execute',
    auditedModulePolicy as unknown as (...args: unknown[]) => void,
  )
  ctx.effect(() => disposeModulePolicy)

  // Backup: after approval, before the write body dispatches.
  const backupWrapper = async (
    exec: { name: string; signal?: AbortSignal },
    next: () => Promise<unknown>,
  ): Promise<unknown> => {
    const parsed = parseMcpToolName(exec.name, modulesById)
    if (parsed === undefined) return next()
    const module = modulesById.get(parsed.moduleId)
    if (module === undefined) return next()
    if (classifyTool(module, parsed.raw) !== 'write') return next()

    const capability = resolveBackup(module, settings.backup)
    const startedAtMs = Date.now()
    const at = new Date().toISOString()

    if (capability.kind === 'none') {
      // No snapshot is expected for this module; policy already gated the write.
      return next()
    }

    if (capability.kind === 'unsupported') {
      const event: BackupEvent = { status: 'unsupported', at, reason: capability.reason }
      backupState.record(module.id, event)
      const blocked = settings.backup.failure === 'block'
      auditBackup(module.id, exec.name, event, Date.now() - startedAtMs, blocked ? 'refused' : 'allowed')
      if (blocked) return backupFailure(module.id, capability.reason)
      return next()
    }

    const previous = lastSnapshotAt.get(module.id)
    if (previous !== undefined && settings.backup.dedupeMs > 0 && startedAtMs - previous < settings.backup.dedupeMs) {
      const seconds = Math.round((startedAtMs - previous) / 1000)
      const event: BackupEvent = {
        status: 'skipped',
        at,
        reason: `Snapshot from ${seconds}s ago reused (backup.dedupeMs=${settings.backup.dedupeMs}).`,
      }
      backupState.record(module.id, event)
      auditBackup(module.id, exec.name, event, 0, 'allowed')
      return next()
    }

    const free = freeMegabytes()
    if (free < settings.backup.minFreeMb) {
      const event: BackupEvent = {
        status: 'skipped',
        at,
        reason: `Free space ${Math.round(free)} MB is below backup.minFreeMb=${settings.backup.minFreeMb}.`,
      }
      backupState.record(module.id, event)
      const blocked = settings.backup.failure === 'block'
      auditBackup(module.id, exec.name, event, 0, blocked ? 'refused' : 'allowed')
      if (blocked) return backupFailure(module.id, event.reason ?? 'insufficient free space')
      return next()
    }

    let destination: string
    try {
      destination = snapshotPath(module)
    } catch (error) {
      const event: BackupEvent = { status: 'failed', at, reason: errorMessage(error) }
      backupState.record(module.id, event)
      const blocked = settings.backup.failure === 'block'
      auditBackup(module.id, exec.name, event, Date.now() - startedAtMs, blocked ? 'refused' : 'allowed')
      if (blocked) return backupFailure(module.id, event.reason ?? 'snapshot path failed')
      return next()
    }

    const outcome = await backupLocks(module.id, () => takeSnapshot(
      module,
      capability,
      catalog(),
      settings.backup,
      destination,
      appRunning(module.id),
      exec.signal,
    ))
    const event: BackupEvent = {
      status: outcome.status,
      at: new Date().toISOString(),
      ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
      ...(outcome.path === undefined ? {} : { path: outcome.path }),
      ...(outcome.bytes === undefined ? {} : { bytes: outcome.bytes }),
      ...(outcome.tool === undefined ? {} : { tool: outcome.tool }),
    }
    if (outcome.status === 'created') {
      lastSnapshotAt.set(module.id, Date.now())
      pruneSnapshots(module.id, settings.backup.keep)
    }
    backupState.record(module.id, event)
    const blocked = outcome.status !== 'created' && settings.backup.failure === 'block'
    auditBackup(module.id, exec.name, event, Date.now() - startedAtMs, blocked ? 'refused' : 'allowed')
    if (blocked) return backupFailure(module.id, outcome.reason ?? 'snapshot was not created')
    return next()
  }
  const disposeBackup = ctx.on(
    'tools/execute',
    backupWrapper as unknown as (...args: unknown[]) => void,
  )
  ctx.effect(() => disposeBackup)

  // Audit every governed write that actually executed, so the log covers
  // modules without snapshot support too.
  const postWriteAudit = async (
    exec: { name: string },
    result: { isError?: boolean },
    next: () => Promise<unknown>,
  ): Promise<unknown> => {
    const found = identify(exec.name)
    if (found !== undefined && found.kind !== 'read') {
      auditWrite({
        ts: new Date().toISOString(),
        module: found.moduleId,
        tool: exec.name,
        decision: 'allow',
        result: result.isError === true ? 'failed' : 'ok',
        durationMs: 0,
      })
    }
    return next()
  }
  const disposePostAudit = ctx.on(
    'tools/post-execute',
    postWriteAudit as unknown as (...args: unknown[]) => void,
  )
  ctx.effect(() => disposePostAudit)

  // Supervise last: every policy, snapshot, and audit hook is registered before
  // the first module can reach `connected`, so no call can race the guards.
  await supervisor.start()
}

