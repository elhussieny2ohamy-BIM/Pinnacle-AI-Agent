/**
 * Backup policy and snapshot store for the PINNACLE MCP hub.
 *
 * Resolves how one module can snapshot its document before a write:
 * - `tool`: the module's MCP server exposes a save tool (Rhino's `rhino_save`).
 * - `file`: the hub copies a configured document while the host app is closed.
 * - `unsupported` / `none`: no snapshot is possible.
 *
 * The store lives under `~/.dsh/pinnacle-hub/backups/<module>/`, prunes to a
 * configured count, and refuses to run below a free-space floor. Every attempt
 * is audited with the resulting path, size, and reason.
 * @module @pinnacle/mcp-hub/src/backup
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, statfsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { auditWrite } from './audit.ts'
import type { AuditRecord } from './audit.ts'
import type { HubBackupConfig, PackModule } from './types.ts'

/** Snapshot lifecycle status shared by audit rows and `doctor`. */
export type BackupStatus = 'created' | 'failed' | 'skipped' | 'unsupported'

/** Where a module's snapshot comes from. */
export type BackupCapability =
  | { kind: 'tool'; tool: string; pathArg?: string; docPathTool?: string }
  | { kind: 'file'; source: string }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'none'; reason: string }

/** One recorded snapshot outcome, kept in memory for `doctor`. */
export interface BackupEvent {
  readonly status: BackupStatus
  readonly at: string
  readonly reason?: string
  readonly path?: string
  readonly bytes?: number
  readonly tool?: string
}

/** Per-process snapshot ledger consumed by `doctor`. */
export interface BackupState {
  /**
   * Record one outcome.
   * @param moduleId - the pack module id.
   * @param event - the outcome to retain.
   */
  record(moduleId: string, event: BackupEvent): void
  /**
   * Read the most recent outcome for a module.
   * @param moduleId - the pack module id.
   * @returns the latest event, or undefined when none was recorded.
   */
  last(moduleId: string): BackupEvent | undefined
}

/** One retained snapshot file. */
export interface SnapshotInfo {
  readonly module: string
  readonly path: string
  readonly bytes: number
  readonly modifiedAt: string
}

/** Root directory for every snapshot. An env override keeps tests off the real profile. */
export function backupRoot(): string {
  return process.env.PINNACLE_BACKUP_DIR ?? join(homedir(), '.dsh', 'pinnacle-hub', 'backups')
}

/** Create the in-memory ledger used by the current process. */
export function createBackupState(): BackupState {
  const events = new Map<string, BackupEvent>()
  return {
    record: (moduleId, event) => {
      events.set(moduleId, event)
    },
    last: moduleId => events.get(moduleId),
  }
}

/**
 * Resolve a module's snapshot capability.
 * @param module - validated pack module.
 * @param settings - the hub's backup policy.
 * @returns the capability; `none` means no snapshot is expected.
 */
export function resolveBackup(module: PackModule, settings: HubBackupConfig): BackupCapability {
  if (module.backup.supported) {
    if (module.backup.tool === undefined) {
      return { kind: 'unsupported', reason: 'Module declares backup support but no backup tool is configured.' }
    }
    return {
      kind: 'tool',
      tool: module.backup.tool,
      ...(module.backup.pathArg === undefined ? {} : { pathArg: module.backup.pathArg }),
      ...(module.backup.docPathTool === undefined ? {} : { docPathTool: module.backup.docPathTool }),
    }
  }
  const file = settings.files[module.id]
  if (file !== undefined) return { kind: 'file', source: file }
  return { kind: 'none', reason: 'Module does not declare backup support and no document file is configured.' }
}

/** Extension used for a snapshot of a module's document. */
function snapshotExtension(module: PackModule): string {
  const tool = module.backup.tool ?? ''
  if (tool.includes('rhino') || module.id === 'rhino') return '.3dm'
  if (module.id === 'rvt') return '.rvt'
  if (module.id === 'autocad' || module.id === 'civil3d') return '.dwg'
  return '.bak'
}

/** Directory for one module's snapshots. */
export function moduleBackupDir(moduleId: string, root = backupRoot()): string {
  return join(root, moduleId)
}

/** Whether a path stays inside the backup root (no traversal from module ids). */
function insideRoot(candidate: string, root: string): boolean {
  const normalized = candidate.toLowerCase().replace(/\\/g, '/')
  const base = root.toLowerCase().replace(/\\/g, '/').replace(/\/$/, '')
  return normalized === base || normalized.startsWith(`${base}/`)
}

/**
 * Allocate a unique snapshot path for a module.
 * @param module - the module being snapshotted.
 * @param now - timestamp used in the name (tests pin it).
 * @param root - backup root override.
 * @returns an absolute path whose parent directory exists.
 */
export function snapshotPath(module: PackModule, now = new Date(), root = backupRoot()): string {
  const dir = moduleBackupDir(module.id, root)
  mkdirSync(dir, { recursive: true })
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const ext = snapshotExtension(module)
  let candidate = join(dir, `${stamp}${ext}`)
  let counter = 1
  while (existsSync(candidate)) {
    candidate = join(dir, `${stamp}-${counter}${ext}`)
    counter += 1
  }
  if (!insideRoot(candidate, root)) throw new Error(`snapshot path escapes the backup root: ${candidate}`)
  return candidate
}

/**
 * Free space on the volume holding the backup root.
 * @param root - backup root override.
 * @returns free megabytes, or Infinity when the platform cannot report it.
 */
export function freeMegabytes(root = backupRoot()): number {
  try {
    mkdirSync(root, { recursive: true })
    const stats = statfsSync(root)
    return (stats.bavail * stats.bsize) / (1024 * 1024)
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** List snapshot files across every module, newest first. */
export function listSnapshots(root = backupRoot()): SnapshotInfo[] {
  const result: SnapshotInfo[] = []
  let modules: string[]
  try {
    modules = readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return result
  }
  for (const module of modules) {
    const dir = join(root, module)
    let files: string[]
    try {
      files = readdirSync(dir)
    } catch {
      continue
    }
    for (const file of files) {
      const path = join(dir, file)
      try {
        const stats = statSync(path)
        if (!stats.isFile()) continue
        result.push({ module, path, bytes: stats.size, modifiedAt: stats.mtime.toISOString() })
      } catch {
        // A file removed between listing and stat is simply absent.
      }
    }
  }
  return result.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

/**
 * Delete the oldest snapshots beyond the retention count.
 * @param moduleId - the module whose directory is pruned.
 * @param keep - snapshots to retain.
 * @param root - backup root override.
 * @returns how many files were removed.
 */
export function pruneSnapshots(moduleId: string, keep: number, root = backupRoot()): number {
  const dir = moduleBackupDir(moduleId, root)
  let files: string[]
  try {
    files = readdirSync(dir)
      .map(name => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
      .filter(entry => entry.mtime > 0)
      .sort((a, b) => b.mtime - a.mtime)
      .map(entry => entry.name)
  } catch {
    return 0
  }
  let removed = 0
  for (const file of files.slice(keep)) {
    const path = join(dir, file)
    if (!insideRoot(path, root)) continue
    try {
      unlinkSync(path)
      removed += 1
    } catch {
      // A snapshot another process holds open stays; the next prune retries.
    }
  }
  return removed
}

/** Run tasks for one key strictly in order. */
export function serializeByKey(): <T>(key: string, task: () => Promise<T>) => Promise<T> {
  const chains = new Map<string, Promise<unknown>>()
  return async <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = chains.get(key) ?? Promise.resolve()
    const next = previous.then(task, task)
    chains.set(key, next.catch(() => undefined))
    try {
      return await next
    } finally {
      if (chains.get(key) === next || chains.get(key) === undefined) chains.delete(key)
    }
  }
}

/**
 * Append one snapshot outcome to the audit log.
 * @param module - module id.
 * @param tool - public tool name that triggered the snapshot.
 * @param event - the outcome.
 * @param durationMs - wall-clock duration.
 * @param outcome - whether the write was allowed to continue.
 */
export function auditBackup(
  module: string,
  tool: string,
  event: BackupEvent,
  durationMs: number,
  outcome: 'allowed' | 'refused',
): void {
  let decision: AuditRecord['decision']
  let result: AuditRecord['result']
  if (outcome === 'refused') {
    decision = 'deny'
    result = 'refused'
  } else if (event.status === 'failed') {
    decision = 'allow'
    result = 'failed'
  } else {
    decision = 'allow'
    result = 'ok'
  }
  auditWrite({
    ts: event.at,
    module,
    tool,
    decision,
    result,
    durationMs,
    ...(event.reason === undefined ? {} : { detail: event.reason }),
    backup: {
      status: event.status,
      ...(event.path === undefined ? {} : { path: event.path }),
      ...(event.bytes === undefined ? {} : { bytes: event.bytes }),
      ...(event.tool === undefined ? {} : { tool: event.tool }),
      ...(event.reason === undefined ? {} : { reason: event.reason }),
    },
  })
}

