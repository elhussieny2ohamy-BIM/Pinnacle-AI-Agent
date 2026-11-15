/**
 * Types shared by the hub host, its registry, its supervisor, and the client
 * bundle. Runtime code never lives here.
 * @module @pinnacle/mcp-hub/src/types
 */

/** Write policy applied to one module before a tool call is dispatched. */
export type WriteMode = 'deny' | 'confirm' | 'allow'

/** Whether a discovery result is applied without asking or only after confirmation. */
export type ApplyMode = 'confirm' | 'auto'

/**
 * Settled supervision state of one module, plus the transient `starting` phase
 * while the MCP client negotiates. Folding `starting` into `error` would report
 * a failure on every normal launch, so it stays separate.
 */
export type ModuleState = 'disabled' | 'app_not_running' | 'starting' | 'connected' | 'error'

/** Per-module defaults inherited by every pack entry that does not override them. */
export interface HubDefaults {
  /** Named capability profile the hub starts with. */
  readonly profile: string
  /** Policy for tools classified `write`, until a module overrides it. */
  readonly writeMode: WriteMode
  /** Upper bound on tools exposed to the model at once. */
  readonly maxVisibleTools: number
  /** Interval between app-gate process scans, in milliseconds. */
  readonly pollMs: number
}

/** How the hub treats the paths and process names produced by discovery. */
export interface HubDiscoveryConfig {
  readonly applyMode: ApplyMode
}

/** Behavior when a declared snapshot cannot be taken. */
export type BackupFailureMode = 'block' | 'warn'

/** Backup policy shared by every module that declares snapshot support. */
export interface HubBackupConfig {
  /** Whether a failed snapshot refuses the write (`block`) or only audits it (`warn`). */
  readonly failure: BackupFailureMode
  /** Reuse a snapshot taken within this window instead of taking another one. */
  readonly dedupeMs: number
  /** Snapshots retained per module; the oldest are pruned. */
  readonly keep: number
  /** Refuse to snapshot when free space on the backup volume is below this. */
  readonly minFreeMb: number
  /** Budget for one snapshot call, including the document-path lookup. */
  readonly timeoutMs: number
  /** Absolute document paths the hub copies when the host application is closed, keyed by module id. */
  readonly files: Readonly<Record<string, string>>
}

/** Validated hub configuration from the `cordis.patch.yml` row. */
export interface HubConfig {
  /** Pack package names loaded at startup, in registration order. */
  readonly packs: readonly string[]
  readonly discovery: HubDiscoveryConfig
  readonly defaults: HubDefaults
  readonly backup: HubBackupConfig
}

/** Reconnect policy forwarded to the MCP client for one server entry. */
export interface ReconnectSettings {
  readonly enabled?: boolean
  readonly initialDelayMs?: number
  readonly maxDelayMs?: number
  readonly maxAttempts?: number
}

/**
 * One MCP server entry a pack contributes. The hub forwards it unchanged to
 * `mcp-manager.register`; every field except `transport` is optional because
 * the manager's schema supplies its documented defaults.
 */
export interface ServerEntry {
  readonly transport: 'stdio' | 'streamable-http'
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly toolCallTimeoutMs?: number
  readonly startupTimeoutMs?: number
  readonly closeTimeoutMs?: number
  readonly reconnect?: ReconnectSettings
}

/** How the supervisor decides whether a module's host application is running. */
export interface AppDeclaration {
  /**
   * Process names (with or without `.exe`) that prove the application is up.
   * An empty list leaves the gate off until discovery fills it.
   */
  readonly processNames: readonly string[]
}

/** One MCP server advertised by a pack. */
export interface PackModule {
  /** Stable module id used by commands, policy, and the audit log. */
  readonly id: string
  /** Display name shown in the hub page and command output. */
  readonly title: string
  /** Tool-name prefix the MCP server uses, used to attribute calls to this module. */
  readonly toolPrefix: string
  /** Whether the module needs its host application running before it can connect. */
  readonly requiresApp: boolean
  /** Declares whether the module can snapshot its document before a write. */
  readonly backup: {
    readonly supported: boolean
    /** Raw MCP tool name that takes the snapshot (e.g. `rhino_save`). */
    readonly tool?: string
    /** Save-tool argument that names the destination file, when it accepts one. */
    readonly pathArg?: string
    /** Read-only tool that reports the current document path, used for copy-after-save. */
    readonly docPathTool?: string
  }
  /** Raw tool names that always count as writes, overriding name heuristics. */
  readonly writes?: readonly string[]
  /** Raw tool names that always count as reads, overriding name heuristics. */
  readonly reads?: readonly string[]
  /** The MCP server entry the supervisor registers; absent for metadata-only packs. */
  readonly server?: ServerEntry
  /** Process names used to gate registration on the host application. */
  readonly app?: AppDeclaration
  /** Discovery hints used to locate the server and host application on this machine. */
  readonly discovery?: {
    /** Known file-system paths where the MCP server executable may live. */
    readonly serverPaths?: readonly string[]
    /** Known file-system paths where the host application may be installed. */
    readonly appPaths?: readonly string[]
    /** When true, the module cannot be used on this machine (e.g. host app absent). */
    readonly unsupported?: boolean
  }
}

/** The value a pack package exports under `pack`. */
export interface PackManifest {
  readonly name: string
  readonly version: string
  readonly modules: readonly PackModule[]
}

/** A pack that was resolved and validated. */
export interface LoadedPack {
  /** Package name the pack was imported from. */
  readonly packageName: string
  readonly manifest: PackManifest
}

/** One module as the hub page, commands, and `doctor` read it. */
export interface ModuleStatus {
  /** Stable module id from the pack. */
  readonly id: string
  /** Display name from the pack. */
  readonly title: string
  readonly state: ModuleState
  /** Actionable explanation of the current state, safe to show to the user. */
  readonly detail: string
  /** Whether this module has a populated process gate. */
  readonly appGate: boolean
  /** Whether the gate's last process scan found the application. */
  readonly appRunning: boolean
  /** ISO timestamp when the state last changed. */
  readonly since: string
}

/** Outcome of one probe, whether delegated to the manager or temporary. */
export interface ProbeOutcome {
  readonly ok: boolean
  /** Phase that produced the outcome. */
  readonly stage: 'register' | 'connect' | 'list' | 'timeout'
  /** Diagnostic text for a failure. */
  readonly message?: string
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number
  /** Registered tools reported by the manager probe, when available. */
  readonly toolCount?: number
  /** Cleanup failure reported after the probe closed its transport. */
  readonly cleanupError?: string
}

/** Snapshot returned by `pinnacleHub.status()`. */
export interface HubStatus {
  /** ISO timestamp of the hub's activation. */
  readonly startedAt: string
  readonly config: HubConfig
  readonly packs: readonly LoadedPack[]
  /** Every module the supervisor tracks, in pack declaration order. */
  readonly modules: readonly ModuleStatus[]
  /** True once the owning fiber is disposing. */
  readonly stopped: boolean
}

/** Confidence that a module's server and host application can be located. */
export type DiscoveryConfidence = 'high' | 'medium' | 'low' | 'none'

/** The subset of a pack module that discovery needs: id, title, app gate, and discovery hints. */
export interface DiscoverableModule {
  readonly id: string
  readonly title: string
  readonly requiresApp: boolean
  readonly app?: AppDeclaration
  readonly discovery?: {
    readonly serverPaths?: readonly string[]
    readonly appPaths?: readonly string[]
    readonly unsupported?: boolean
  }
}

/** Result of discovering one module on the current machine. Read-only: it never registers a server. */
export interface DiscoveryResult {
  /** Stable module id from the pack. */
  readonly id: string
  /** Display name from the pack. */
  readonly title: string
  /** Whether the module needs its host application running. */
  readonly requiresApp: boolean
  /** Resolved MCP server command path, when one exists on disk. */
  readonly command: string | null
  /** Whether a host-application install marker was found on disk. */
  readonly appInstalled: boolean
  /** Whether the host application process is currently running. */
  readonly appRunning: boolean
  /** Confidence that this module is usable on this machine. */
  readonly confidence: DiscoveryConfidence
  /** Human-readable evidence for the assigned confidence. */
  readonly evidence: readonly string[]
  /** When true, the module cannot be used on this machine (e.g. host app absent). */
  readonly unsupported: boolean
}

/** Full diagnosis of one module, combining discovery and supervision state. */
export interface DoctorModule {
  readonly id: string
  readonly title: string
  readonly confidence: DiscoveryConfidence
  readonly state: ModuleState
  readonly detail: string
  readonly command: string | null
  readonly appInstalled: boolean
  readonly appRunning: boolean
  readonly unsupported: boolean
  readonly issues: readonly string[]
}

/** Backup readiness of one module, surfaced by `doctor`. */
export interface DoctorBackup {
  /** Stable module id. */
  readonly id: string
  /** Whether the pack declares snapshot support. */
  readonly supported: boolean
  /** Where the snapshot comes from on this machine. */
  readonly capability: 'tool' | 'file' | 'none' | 'unsupported'
  /** Raw backup tool name, when the capability is `tool`. */
  readonly tool?: string
  /** ISO timestamp of the most recent snapshot taken by this process. */
  readonly lastSnapshotAt?: string
  /** Failure detail from the most recent snapshot attempt in this process. */
  readonly lastError?: string
  /** Actionable problems with this module's backup configuration. */
  readonly issues: readonly string[]
}

/** Output of `/aec doctor`: per-module issues plus environment-wide checks. */
export interface DoctorReport {
  /** ISO timestamp when the report was generated. */
  readonly generatedAt: string
  /** Whether the approval service is present (needed for write confirm/ask). */
  readonly approvalService: boolean
  /** Packs loaded and their module counts. */
  readonly packs: readonly { readonly packageName: string; readonly moduleCount: number }[]
  /** Per-module diagnosis. */
  readonly modules: readonly DoctorModule[]
  /** Per-module backup readiness. */
  readonly backup: readonly DoctorBackup[]
  /** Environment-wide issues (port conflicts, stale paths, version drift). */
  readonly environment: readonly string[]
}

