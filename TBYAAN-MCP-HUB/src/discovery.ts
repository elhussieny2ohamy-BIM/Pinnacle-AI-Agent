/**
 * Discovery engine: scans the current machine for each pack module's MCP server
 * and host application, then assigns a confidence and evidence per module.
 *
 * Discovery is read-only: it never registers a server with `mcp-manager`. The
 * supervisor owns registration; discovery only reports what can be found and
 * how confidently. Results are meant for the `/aec discover` confirmation table
 * and for `doctor`.
 * @module @PINNACLE/mcp-hub/src/discovery
 */

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeProcessName } from './app-gate.ts'
import type { AppGate } from './supervisor.ts'
import type { DiscoveryConfidence, DiscoveryResult, DiscoverableModule } from './types.ts'

/** Check whether a path exists on disk. */
function pathExists(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve one path pattern to an existing file path.
 * A plain path is returned as-is when it exists. A pattern containing a single
 * `*` is treated as a directory glob: every directory beneath the part before
 * `*` is checked for the part after `*`, and the highest directory name wins.
 * This is used for Navisworks `versions\*\NavisHelper.McpServer.exe`.
 */
function resolveGlob(pattern: string): string | null {
  const starIdx = pattern.indexOf('*')
  if (starIdx === -1) return pathExists(pattern) ? pattern : null
  const dirPart = pattern.slice(0, starIdx)
  const rest = pattern.slice(starIdx + 1)
  let best: string | null = null
  try {
    for (const entry of readdirSync(dirPart, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = join(dirPart, entry.name, rest)
      if (pathExists(candidate) && (best === null || entry.name > best)) best = entry.name
    }
  } catch {
    // The directory above the glob may not exist; that is a normal "not found".
  }
  return best === null ? null : join(dirPart, best, rest)
}

/** Resolve the first existing server path from a module's discovery hints. */
function resolveCommand(serverPaths?: readonly string[]): string | null {
  if (!serverPaths) return null
  for (const pattern of serverPaths) {
    const resolved = resolveGlob(pattern)
    if (resolved !== null) return resolved
  }
  return null
}

/** Check whether any host-application install marker exists on disk. */
function checkAppInstalled(appPaths?: readonly string[]): boolean {
  if (!appPaths) return false
  return appPaths.some(pathExists)
}

/** Classify confidence from discovery facts. */
function classify(
  requiresApp: boolean,
  commandResolved: boolean,
  appInstalled: boolean,
  unsupported: boolean,
): DiscoveryConfidence {
  if (unsupported) return 'none'
  if (!requiresApp) return commandResolved ? 'high' : 'low'
  if (commandResolved && appInstalled) return 'high'
  if (commandResolved || appInstalled) return 'medium'
  return 'low'
}

/** Build human-readable evidence for one discovery result. */
function buildEvidence(
  module: DiscoverableModule,
  command: string | null,
  appInstalled: boolean,
  appRunning: boolean,
  confidence: DiscoveryConfidence,
  unsupported: boolean,
): string[] {
  const evidence: string[] = []
  if (unsupported) {
    evidence.push(`Marked unsupported: ${module.discovery === undefined ? 'no reason recorded' : 'pack declares unsupported'}`)
    return evidence
  }
  if (command !== null) evidence.push(`Server executable found at ${command}`)
  else evidence.push(`No server executable found at any known discovery path`)
  if (module.requiresApp) {
    if (appInstalled) evidence.push(`Host application install markers found`)
    else evidence.push(`No host application install marker found`)
    evidence.push(appRunning ? 'Host application process is running' : 'Host application process is not running')
  } else {
    evidence.push('Standalone mode: host application not required')
  }
  evidence.push(`Confidence: ${confidence}`)
  return evidence
}

/**
 * Discover one module per entry in `modules`.
 * @param modules - validated pack modules from the registry.
 * @param appGate - optional process gate; when absent, `appRunning` is always false.
 * @returns discovery results in the same order as `modules`.
 */
export async function discoverModules(
  modules: readonly DiscoverableModule[],
  appGate?: AppGate,
): Promise<DiscoveryResult[]> {
  const requested = new Set<string>()
  for (const module of modules) {
    if (module.app?.processNames.length) {
      for (const name of module.app.processNames) requested.add(name)
    }
  }
  let running = new Set<string>()
  if (appGate !== undefined && requested.size > 0) {
    running = new Set(await appGate.running([...requested]))
  }
  const runningNorm = new Set([...running].map(normalizeProcessName))

  const results: DiscoveryResult[] = []
  for (const module of modules) {
    const command = resolveCommand(module.discovery?.serverPaths)
    const appInstalled = checkAppInstalled(module.discovery?.appPaths)
    const appRunning = module.app
      ? module.app.processNames.some(name => runningNorm.has(normalizeProcessName(name)))
      : false
    const unsupported = module.discovery?.unsupported === true
    const confidence = classify(module.requiresApp, command !== null, appInstalled, unsupported)
    results.push({
      id: module.id,
      title: module.title,
      requiresApp: module.requiresApp,
      command,
      appInstalled,
      appRunning,
      confidence,
      evidence: buildEvidence(module, command, appInstalled, appRunning, confidence, unsupported),
      unsupported,
    })
  }
  return results
}

