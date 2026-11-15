/**
 * Tool-name parsing and write classification for the hub's backup and policy
 * layers.
 *
 * MCP tools are registered under `mcp__<serverName>__<rawName>` where the
 * server name is the module id. Legacy raw names (`rhino_save`) are accepted
 * too, so the policy still works when a server registers tools directly.
 *
 * Classification is allowlist-first (`reads` / `writes` on the pack module),
 * then name-based. Unknown names count as writes: an unrecognized mutation must
 * not slip past the write policy.
 * @module @PINNACLE/mcp-hub/src/backup-names
 */

import type { PackModule } from './types.ts'

/** How one tool call is treated by policy and backup. */
export type ToolKind = 'write' | 'read' | 'backup' | 'unknown'

/** The minimum module fields needed to parse a tool name. */
export interface NamedModule {
  readonly id: string
  readonly toolPrefix: string
}

/** A tool name resolved to its owning module. */
export interface ParsedModuleTool {
  readonly moduleId: string
  /** Tool name as the MCP server declares it, without the namespace. */
  readonly raw: string
}

/** Tokens that identify a mutation regardless of server naming style. */
const WRITE_TOKENS = new Set([
  'save', 'saveas', 'create', 'add', 'update', 'delete', 'remove', 'modify',
  'move', 'copy', 'insert', 'draw', 'write', 'import', 'export', 'apply',
  'edit', 'rename', 'purge', 'reload', 'publish', 'assign', 'link', 'place',
  'load', 'open', 'close', 'new', 'set', 'clear', 'reset', 'run', 'execute',
  'send', 'post', 'put', 'patch', 'upload', 'download', 'sync', 'merge',
  'split', 'trim', 'extrude', 'revolve', 'sweep', 'loft', 'fillet', 'chamfer',
  'boolean', 'mirror', 'array', 'offset', 'scale', 'rotate', 'translate',
  'transform', 'convert', 'bake', 'commit', 'push', 'duplicate', 'batch',
])

/** Tokens that only read state. */
const READ_TOKENS = new Set([
  'get', 'list', 'info', 'read', 'query', 'show', 'status', 'find', 'search',
  'count', 'describe', 'ping', 'health', 'inspect', 'enumerate', 'view',
  'stats', 'report', 'check', 'measure', 'calculate', 'compute', 'version',
])

/** Split a tool name into lowercase word tokens. */
function tokenize(raw: string): string[] {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 0)
}

/**
 * Resolve a public tool name to its module.
 * @param name - the registered tool name.
 * @param modules - every loaded module keyed by module id.
 * @returns the module id and raw tool name, or undefined when the tool is not module-owned.
 */
export function parseMcpToolName(
  name: string,
  modules: ReadonlyMap<string, NamedModule>,
): ParsedModuleTool | undefined {
  const namespaced = /^mcp__([A-Za-z0-9_-]{1,32})__(.+)$/.exec(name)
  if (namespaced !== null) {
    const moduleId = namespaced[1]!
    const raw = namespaced[2]!
    return modules.has(moduleId) ? { moduleId, raw } : undefined
  }
  let best: ParsedModuleTool | undefined
  let bestLength = 0
  for (const module of modules.values()) {
    const prefix = `${module.toolPrefix}_`
    if (name.startsWith(prefix) && name.length > prefix.length && prefix.length > bestLength) {
      best = { moduleId: module.id, raw: name.slice(prefix.length) }
      bestLength = prefix.length
    }
  }
  return best
}

/**
 * Classify one raw tool name for a module.
 * @param module - the owning module declaration.
 * @param raw - tool name without the `mcp__<module>__` namespace.
 * @returns the classification; unknown names count as writes.
 */
export function classifyTool(
  module: Pick<PackModule, 'backup' | 'writes' | 'reads'>,
  raw: string,
): ToolKind {
  if (module.backup.tool === raw) return 'backup'
  if (module.reads?.includes(raw) === true) return 'read'
  if (module.writes?.includes(raw) === true) return 'write'

  const tokens = tokenize(raw)
  const write = tokens.some(token => WRITE_TOKENS.has(token))
  const read = tokens.some(token => READ_TOKENS.has(token))
  if (write) return 'write'
  if (read) return 'read'
  return 'unknown'
}

/**
 * Whether a classification is governed by the write policy.
 * @param kind - classification from {@link classifyTool}.
 * @returns false only for read-only tools.
 */
export function isGoverned(kind: ToolKind): boolean {
  return kind !== 'read'
}

