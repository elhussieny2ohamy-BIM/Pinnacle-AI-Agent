/**
 * Pack registry: resolves the pack package names listed in the hub row and
 * validates each pack's exported manifest before any module reaches the MCP
 * manager. A pack is a plain ESM package exporting `pack`; the hub never reads
 * pack internals, so a broken pack is reported by name instead of crashing the
 * profile.
 * @module @PINNACLE/mcp-hub/src/registry
 */

import { errorMessage } from './message.ts'
import type {
  AppDeclaration, LoadedPack, PackManifest, PackModule, ReconnectSettings, ServerEntry,
} from './types.ts'

/** Raised when a pack cannot be resolved or its manifest is invalid. */
export class PackRegistryError extends Error {
  /** @param message - an actionable description naming the pack and field. */
  constructor(message: string) {
    super(message)
    this.name = 'PackRegistryError'
  }
}

/** Read a record-like value, or fail with the pack and field path. */
function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PackRegistryError(`PINNACLE-mcp-hub: ${path} must be a mapping`)
  }
  return value as Record<string, unknown>
}

/** Read a non-empty string field. */
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PackRegistryError(`PINNACLE-mcp-hub: ${path} must be a non-empty string`)
  }
  return value
}

/** Read a boolean field without coercing truthy values. */
function flag(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new PackRegistryError(`PINNACLE-mcp-hub: ${path} must be a boolean`)
  return value
}

/** Read one enum member, listing the accepted values in the error. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  throw new PackRegistryError(`PINNACLE-mcp-hub: ${path} must be one of ${allowed.join(' | ')}, got ${JSON.stringify(value)}`)
}

/** Read a list of non-empty strings. */
function textList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new PackRegistryError(`PINNACLE-mcp-hub: ${path} must be a list of strings`)
  return value.map((entry, index) => text(entry, `${path}[${index}]`))
}

/** Read a mapping of string keys to string values. */
function textMap(value: unknown, path: string): Record<string, string> {
  const source = record(value, path)
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(source)) result[key] = text(entry, `${path}.${key}`)
  return result
}

/** Read a positive integer. */
function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new PackRegistryError(`PINNACLE-mcp-hub: ${path} must be a positive integer, got ${JSON.stringify(value)}`)
  }
  return value
}

/** Read the optional reconnect policy. */
function readReconnect(value: unknown, path: string): ReconnectSettings {
  const source = record(value, path)
  return {
    ...(source.enabled === undefined ? {} : { enabled: flag(source.enabled, `${path}.enabled`) }),
    ...(source.initialDelayMs === undefined ? {} : { initialDelayMs: integer(source.initialDelayMs, `${path}.initialDelayMs`) }),
    ...(source.maxDelayMs === undefined ? {} : { maxDelayMs: integer(source.maxDelayMs, `${path}.maxDelayMs`) }),
    ...(source.maxAttempts === undefined ? {} : { maxAttempts: integer(source.maxAttempts, `${path}.maxAttempts`) }),
  }
}

/** Validate the optional MCP server entry a pack contributes. */
function readServer(value: unknown, path: string): ServerEntry {
  const source = record(value, path)
  const transport = oneOf(source.transport, ['stdio', 'streamable-http'] as const, `${path}.transport`)
  const entry: ServerEntry = {
    transport,
    ...(source.command === undefined ? {} : { command: text(source.command, `${path}.command`) }),
    ...(source.args === undefined ? {} : { args: textList(source.args, `${path}.args`) }),
    ...(source.env === undefined ? {} : { env: textMap(source.env, `${path}.env`) }),
    ...(source.cwd === undefined ? {} : { cwd: text(source.cwd, `${path}.cwd`) }),
    ...(source.url === undefined ? {} : { url: text(source.url, `${path}.url`) }),
    ...(source.headers === undefined ? {} : { headers: textMap(source.headers, `${path}.headers`) }),
    ...(source.toolCallTimeoutMs === undefined
      ? {}
      : { toolCallTimeoutMs: integer(source.toolCallTimeoutMs, `${path}.toolCallTimeoutMs`) }),
    ...(source.startupTimeoutMs === undefined
      ? {}
      : { startupTimeoutMs: integer(source.startupTimeoutMs, `${path}.startupTimeoutMs`) }),
    ...(source.closeTimeoutMs === undefined
      ? {}
      : { closeTimeoutMs: integer(source.closeTimeoutMs, `${path}.closeTimeoutMs`) }),
    ...(source.reconnect === undefined ? {} : { reconnect: readReconnect(source.reconnect, `${path}.reconnect`) }),
  }
  if (transport === 'stdio' && entry.command === undefined) {
    throw new PackRegistryError(`PINNACLE-mcp-hub: ${path}.command is required for a stdio server`)
  }
  if (transport === 'streamable-http' && entry.url === undefined) {
    throw new PackRegistryError(`PINNACLE-mcp-hub: ${path}.url is required for a streamable-http server`)
  }
  return entry
}

/** Validate the optional app-gate declaration. */
function readApp(value: unknown, path: string): AppDeclaration {
  const source = record(value, path)
  return {
    processNames: source.processNames === undefined ? [] : textList(source.processNames, `${path}.processNames`),
  }
}

/** Validate the optional discovery hints. */
function readDiscovery(value: unknown, path: string): PackModule['discovery'] {
  const source = record(value, path)
  return {
    ...(source.serverPaths === undefined
      ? {}
      : { serverPaths: textList(source.serverPaths, `${path}.serverPaths`) }),
    ...(source.appPaths === undefined
      ? {}
      : { appPaths: textList(source.appPaths, `${path}.appPaths`) }),
    ...(source.unsupported === undefined
      ? {}
      : { unsupported: flag(source.unsupported, `${path}.unsupported`) }),
  }
}

/** Validate one module declaration. */
function readModule(value: unknown, path: string): PackModule {
  const source = record(value, path)
  const backup = record(source.backup, `${path}.backup`)
  return {
    id: text(source.id, `${path}.id`),
    title: text(source.title, `${path}.title`),
    toolPrefix: text(source.toolPrefix, `${path}.toolPrefix`),
    requiresApp: flag(source.requiresApp, `${path}.requiresApp`),
    backup: {
      supported: flag(backup.supported, `${path}.backup.supported`),
      ...(backup.tool === undefined ? {} : { tool: text(backup.tool, `${path}.backup.tool`) }),
      ...(backup.pathArg === undefined ? {} : { pathArg: text(backup.pathArg, `${path}.backup.pathArg`) }),
      ...(backup.docPathTool === undefined
        ? {}
        : { docPathTool: text(backup.docPathTool, `${path}.backup.docPathTool`) }),
    },
    ...(source.writes === undefined ? {} : { writes: textList(source.writes, `${path}.writes`) }),
    ...(source.reads === undefined ? {} : { reads: textList(source.reads, `${path}.reads`) }),
    ...(source.server === undefined ? {} : { server: readServer(source.server, `${path}.server`) }),
    ...(source.app === undefined ? {} : { app: readApp(source.app, `${path}.app`) }),
    ...(source.discovery === undefined ? {} : { discovery: readDiscovery(source.discovery, `${path}.discovery`) }),
  } as PackModule
}

/**
 * Reject module ids or tool prefixes declared twice inside one pack: a tool
 * name must map to exactly one module for policy and audit attribution.
 * @param modules - the pack's modules, validated individually.
 * @param packageName - the pack name used in the failure message.
 * @throws {PackRegistryError} when an id or prefix repeats.
 */
function assertUniqueModules(modules: readonly PackModule[], packageName: string): void {
  const ids = new Set<string>()
  const prefixes = new Set<string>()
  for (const module of modules) {
    if (ids.has(module.id)) {
      throw new PackRegistryError(`PINNACLE-mcp-hub: ${packageName} declares module id ${JSON.stringify(module.id)} twice`)
    }
    if (prefixes.has(module.toolPrefix)) {
      throw new PackRegistryError(
        `PINNACLE-mcp-hub: ${packageName} declares tool prefix ${JSON.stringify(module.toolPrefix)} twice; `
        + 'tool names must map to exactly one module',
      )
    }
    ids.add(module.id)
    prefixes.add(module.toolPrefix)
  }
}

/** Validate the `pack` export of one package. */
function readManifest(value: unknown, packageName: string): PackManifest {
  const source = record(value, `${packageName} pack`)
  if (!Array.isArray(source.modules)) {
    throw new PackRegistryError(`PINNACLE-mcp-hub: ${packageName} pack.modules must be a list`)
  }
  const modules = source.modules.map((entry, index) => readModule(entry, `${packageName} pack.modules[${index}]`))
  assertUniqueModules(modules, packageName)
  return {
    name: text(source.name, `${packageName} pack.name`),
    version: text(source.version, `${packageName} pack.version`),
    modules,
  }
}

/** Import one pack package and validate its manifest. */
async function loadPack(packageName: string): Promise<LoadedPack> {
  let exported: unknown
  try {
    exported = await import(packageName)
  } catch (error) {
    throw new PackRegistryError(
      `PINNACLE-mcp-hub: cannot load pack ${JSON.stringify(packageName)}: ${errorMessage(error)}. `
      + `Install it into this profile with 'dsh plugin add ${packageName}' or remove it from config.packs.`,
    )
  }
  const namespace = record(exported, `${packageName} exports`)
  if (namespace.pack === undefined) {
    throw new PackRegistryError(
      `PINNACLE-mcp-hub: ${packageName} does not export 'pack'; a pack package must export its manifest as 'pack'`,
    )
  }
  return { packageName, manifest: readManifest(namespace.pack, packageName) }
}

/** Reject a package listed twice before any import runs. */
function assertUniqueNames(packageNames: readonly string[]): void {
  const seen = new Set<string>()
  for (const name of packageNames) {
    if (seen.has(name)) {
      throw new PackRegistryError(`PINNACLE-mcp-hub: pack ${JSON.stringify(name)} is listed twice in config.packs`)
    }
    seen.add(name)
  }
}

/** Reject one module id declared by two packs. */
function assertUniqueModuleOwners(packs: readonly LoadedPack[]): void {
  const owners = new Map<string, string>()
  for (const pack of packs) {
    for (const module of pack.manifest.modules) {
      const owner = owners.get(module.id)
      if (owner !== undefined) {
        throw new PackRegistryError(
          `PINNACLE-mcp-hub: module id ${JSON.stringify(module.id)} is declared by both ${owner} and ${pack.packageName}`,
        )
      }
      owners.set(module.id, pack.packageName)
    }
  }
}

/**
 * Resolve every configured pack in declaration order.
 * @param packageNames - pack package names from `config.packs`.
 * @returns the validated packs, in the configured order.
 * @throws {PackRegistryError} for duplicate names, unresolvable packages, or invalid manifests.
 */
export async function loadPacks(packageNames: readonly string[]): Promise<LoadedPack[]> {
  assertUniqueNames(packageNames)
  const loaded: LoadedPack[] = []
  for (const name of packageNames) loaded.push(await loadPack(name))
  assertUniqueModuleOwners(loaded)
  return loaded
}

