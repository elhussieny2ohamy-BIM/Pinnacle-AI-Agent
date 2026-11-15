/**
 * Project loaded packs into supervisor specs. A pack module without a `server`
 * entry stays metadata-only, which keeps Phase 1 packs loadable while a region
 * or a catalog entry is still being built.
 * @module @pinnacle/mcp-hub/src/modules
 */

import type { ModuleSpec } from './supervisor.ts'
import type { LoadedPack } from './types.ts'

/**
 * Build supervisor specs in pack declaration order.
 * @param packs - validated packs from the registry.
 * @returns one spec per module that declares an MCP server entry.
 */
export function moduleSpecs(packs: readonly LoadedPack[]): ModuleSpec[] {
  const specs: ModuleSpec[] = []
  for (const pack of packs) {
    for (const module of pack.manifest.modules) {
      if (module.server === undefined) continue
      specs.push({
        id: module.id,
        title: module.title,
        enabled: true,
        requiresApp: module.requiresApp,
        processNames: module.app?.processNames ?? [],
        entry: module.server,
        ...(module.discovery === undefined ? {} : { discovery: module.discovery }),
      })
    }
  }
  return specs
}

