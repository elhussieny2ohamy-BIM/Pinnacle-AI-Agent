/**
 * Snapshot execution for the PINNACLE MCP hub.
 *
 * Two sources, decided by {@link resolveBackup}:
 * - an MCP save tool that either writes straight to the snapshot path or saves
 *   in place while a document-info tool reports the file to copy;
 * - a configured document file the hub copies while the host app is closed.
 *
 * Tool calls go through the registry's own definitions, so the backup runs on
 * the connection the supervisor already owns â€” no second MCP process.
 * @module @PINNACLE/mcp-hub/src/backup-runner
 */

import { closeSync, copyFileSync, existsSync, openSync, statSync } from 'node:fs'
import { errorMessage } from './message.ts'
import type { BackupCapability, BackupStatus } from './backup.ts'
import type { HubBackupConfig, PackModule } from './types.ts'

/** Extension pattern for a document path found in a tool result. */
const DOCUMENT_PATTERN = /\.(3dm|rvt|rfa|dwg|dxf|skp|nwd|nwc)$/i

/** The structural part of a registered tool the runner needs. */
export interface CallableTool {
  readonly name: string
  readonly description?: string
  readonly parameters?: Record<string, unknown>
  execute(args: unknown, exec: unknown): Promise<unknown>
}

/** Registry surface used to find and call module tools. */
export interface ToolCatalog {
  executable(name: string): CallableTool | undefined
  definitions?(): readonly CallableTool[]
}

/** What a save tool accepts, discovered from its schema and the module hints. */
export interface ToolCapability {
  readonly saveTool: CallableTool | null
  readonly pathParam: string | null
  readonly docPathTool: CallableTool | null
}

/** Outcome of one snapshot attempt. */
export interface SnapshotOutcome {
  readonly status: BackupStatus
  readonly reason?: string
  readonly path?: string
  readonly bytes?: number
  readonly tool?: string
}

/** Public MCP name for a module's raw tool. */
function publicName(moduleId: string, raw: string): string {
  return `mcp__${moduleId}__${raw}`
}

/** Read an object schema's property names without trusting its shape. */
function propertyNames(schema: Record<string, unknown> | undefined): string[] {
  if (schema === undefined) return []
  const properties = schema.properties
  if (typeof properties !== 'object' || properties === null) return []
  return Object.keys(properties as Record<string, unknown>)
}

/** Find a save-tool argument that names the destination. */
function detectPathParam(schema: Record<string, unknown> | undefined): string | null {
  const names = propertyNames(schema)
  const exact = names.find(name => /^(path|file|filepath|file_path|filename|filename_path|save_path|output|output_path|destination)$/i.test(name))
  if (exact !== undefined) return exact
  return names.find(name => /path|file|filename|destination|output/i.test(name)) ?? null
}

/** Find a read-only tool that reports the current document path. */
function detectDocPathTool(
  tools: ToolCatalog,
  moduleId: string,
  hinted: string | undefined,
): CallableTool | null {
  if (hinted !== undefined) {
    const hintedTool = tools.executable(publicName(moduleId, hinted))
    if (hintedTool !== undefined) return hintedTool
  }
  for (const tool of tools.definitions?.() ?? []) {
    const prefix = `mcp__${moduleId}__`
    if (!tool.name.startsWith(prefix)) continue
    const raw = tool.name.slice(prefix.length)
    if (/(document|drawing|model|file).*(info|path)/i.test(raw) || /^(get|current).*(document|drawing|model|file)/i.test(raw)) {
      return tool
    }
  }
  return null
}

/**
 * Probe how a module's save tool takes a snapshot.
 * @param tools - registry surface, or undefined when no tool service exists.
 * @param module - owning module.
 * @param capability - the resolved `tool` capability.
 * @returns the save tool, destination argument, and optional document-info tool.
 */
export function probeToolCapability(
  tools: ToolCatalog | undefined,
  module: PackModule,
  capability: Extract<BackupCapability, { kind: 'tool' }>,
): ToolCapability {
  if (tools === undefined) return { saveTool: null, pathParam: null, docPathTool: null }
  const saveTool = tools.executable(publicName(module.id, capability.tool)) ?? null
  const pathParam = capability.pathArg ?? detectPathParam(saveTool?.parameters)
  const docPathTool = detectDocPathTool(tools, module.id, capability.docPathTool)
  return { saveTool, pathParam, docPathTool }
}

/** Recursively find the first document-looking path in a tool result. */
export function findDocumentPath(value: unknown): string | null {
  if (typeof value === 'string') return DOCUMENT_PATTERN.test(value) ? value : null
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findDocumentPath(entry)
      if (found !== null) return found
    }
    return null
  }
  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      const found = findDocumentPath(entry)
      if (found !== null) return found
    }
  }
  return null
}

/** Reject when the budget or the caller aborts, even if a tool ignores its signal. */
function abortWith(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = (): void => reject(new Error(signal.reason instanceof Error ? signal.reason.message : 'backup call aborted'))
    if (signal.aborted) {
      fail()
      return
    }
    signal.addEventListener('abort', fail, { once: true })
  })
}

/** Call one tool with a budget and the caller's cancellation. */
async function callTool(
  tool: CallableTool,
  args: Record<string, unknown>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  if (combined.aborted) throw new Error('cancelled before the backup started')
  return Promise.race([
    tool.execute(args, { signal: combined, name: tool.name, arguments: args }),
    abortWith(combined),
  ])
}

/** Size of a completed file, or undefined when it did not appear. */
function fileSize(path: string): number | undefined {
  try {
    const stats = statSync(path)
    return stats.isFile() ? stats.size : undefined
  } catch {
    return undefined
  }
}

/** Whether a file is currently held open for writing by another process. */
function isLocked(path: string): boolean {
  try {
    closeSync(openSync(path, 'r+'))
    return false
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'EBUSY' || code === 'EPERM'
  }
}

/** Snapshot through an MCP save tool. */
async function snapshotWithTool(
  module: PackModule,
  capability: Extract<BackupCapability, { kind: 'tool' }>,
  tools: ToolCatalog | undefined,
  destination: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<SnapshotOutcome> {
  const probe = probeToolCapability(tools, module, capability)
  if (probe.saveTool === null) {
    return { status: 'unsupported', reason: `Backup tool ${capability.tool} is not registered; is the module connected?` }
  }
  if (probe.pathParam !== null) {
    await callTool(probe.saveTool, { [probe.pathParam]: destination }, timeoutMs, signal)
    const bytes = fileSize(destination)
    if (bytes === undefined) {
      return { status: 'failed', reason: `Save tool reported success but ${destination} was not written.`, tool: capability.tool }
    }
    return { status: 'created', path: destination, bytes, tool: capability.tool }
  }
  if (probe.docPathTool === null) {
    return {
      status: 'unsupported',
      reason: `Cannot snapshot ${module.id}: ${capability.tool} accepts no destination and no document-path tool is available.`,
      tool: capability.tool,
    }
  }
  await callTool(probe.saveTool, {}, timeoutMs, signal)
  const info = await callTool(probe.docPathTool, {}, timeoutMs, signal)
  const source = findDocumentPath(info)
  if (source === null) {
    return { status: 'unsupported', reason: 'Document-path tool returned no recognizable path.', tool: capability.tool }
  }
  if (!existsSync(source)) {
    return { status: 'failed', reason: `Document path reported by the server does not exist: ${source}`, tool: capability.tool }
  }
  copyFileSync(source, destination)
  return { status: 'created', path: destination, bytes: fileSize(destination) ?? 0, tool: capability.tool }
}

/** Snapshot a configured file while the host application is closed. */
function snapshotFile(
  capability: Extract<BackupCapability, { kind: 'file' }>,
  destination: string,
  appRunning: boolean,
): SnapshotOutcome {
  if (appRunning) {
    return { status: 'skipped', reason: 'Host application is running; the hub only copies a closed document.' }
  }
  if (!existsSync(capability.source)) {
    return { status: 'failed', reason: `Configured document does not exist: ${capability.source}` }
  }
  if (isLocked(capability.source)) {
    return { status: 'skipped', reason: 'Configured document is locked by another process.' }
  }
  copyFileSync(capability.source, destination)
  return { status: 'created', path: destination, bytes: fileSize(destination) ?? 0 }
}

/**
 * Take one snapshot for a module. Never throws: every failure becomes a
 * {@link SnapshotOutcome} the caller audits and acts on.
 * @param module - owning module.
 * @param capability - resolved `tool` or `file` capability.
 * @param tools - registry surface for tool-backed snapshots.
 * @param settings - backup policy (timeout).
 * @param destination - absolute snapshot path.
 * @param appRunning - whether the module's host application is running.
 * @param signal - caller cancellation.
 * @returns the outcome, including the snapshot path and size on success.
 */
export async function takeSnapshot(
  module: PackModule,
  capability: Extract<BackupCapability, { kind: 'tool' | 'file' }>,
  tools: ToolCatalog | undefined,
  settings: HubBackupConfig,
  destination: string,
  appRunning: boolean,
  signal?: AbortSignal,
): Promise<SnapshotOutcome> {
  try {
    if (capability.kind === 'file') return snapshotFile(capability, destination, appRunning)
    return await snapshotWithTool(module, capability, tools, destination, settings.timeoutMs, signal)
  } catch (error) {
    return { status: 'failed', reason: errorMessage(error) }
  }
}

