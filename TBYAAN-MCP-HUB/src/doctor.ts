/**
 * Doctor: full diagnosis of the hub environment and every module.
 *
 * Combines discovery results (server/application presence and confidence)
 * with supervision state (enabled/connected/error) and environment-wide
 * checks (approval service, port conflicts, stale paths, version drift).
 * Read-only: it never changes configuration or registrations.
 * @module @PINNACLE/mcp-hub/src/doctor
 */

import type {
  DiscoveryConfidence, DiscoveryResult, DoctorBackup, DoctorModule, DoctorReport, ModuleStatus, PackModule,
} from './types.ts'

/** Known internal ports per module, used to detect port conflicts. */
const MODULE_PORTS: Record<string, number> = {
  civil3d: 8080,
  sketchup: 9876,
}

/** Build per-module diagnosis from discovery + supervision state. */
function buildModules(
  packs: readonly { readonly packageName: string; readonly modules: readonly PackModule[] }[],
  discovery: readonly DiscoveryResult[],
  statuses: readonly ModuleStatus[],
): DoctorModule[] {
  const byDiscovery = new Map(discovery.map(d => [d.id, d]))
  const byStatus = new Map(statuses.map(s => [s.id, s]))
  const modules: DoctorModule[] = []
  for (const pack of packs) {
    for (const module of pack.modules) {
      const found = byDiscovery.get(module.id)
      const status = byStatus.get(module.id)
      const issues: string[] = []
      const command = found === undefined ? null : found.command
      const appInstalled = found === undefined ? false : found.appInstalled
      const appRunning = found === undefined ? false : found.appRunning
      const confidence = found === undefined ? 'none' : found.confidence
      const unsupported = found === undefined ? false : found.unsupported

      if (unsupported) issues.push('Module is unsupported on this machine; see discovery evidence.')
      if (command === null) issues.push('No MCP server command resolved; cannot register or connect.')
      else if (module.requiresApp && !appInstalled) issues.push('Host application not installed; command alone is not sufficient.')
      if (module.requiresApp && !appRunning) issues.push('Host application is not running; module will stay app_not_running.')
      if (status === undefined) {
        issues.push('Module is not tracked by the supervisor (no server entry in pack).')
      } else if (status.state === 'error') {
        issues.push(`Supervision error: ${status.detail}`)
      } else if (status.state === 'app_not_running') {
        issues.push('Waiting for the host application to start.')
      }

      modules.push({
        id: module.id,
        title: module.title,
        confidence,
        state: status === undefined ? 'disabled' : status.state,
        detail: status === undefined ? 'Not registered with the supervisor.' : status.detail,
        command,
        appInstalled,
        appRunning,
        unsupported,
        issues,
      })
    }
  }
  return modules
}

/** Check for known port conflicts between modules. */
function portConflicts(packs: readonly { readonly modules: readonly PackModule[] }[]): string[] {
  const issues: string[] = []
  const seen = new Map<number, string>()
  for (const pack of packs) {
    for (const module of pack.modules) {
      const port = MODULE_PORTS[module.id]
      if (port === undefined) continue
      const owner = seen.get(port)
      if (owner === undefined) seen.set(port, module.id)
      else issues.push(`Port ${port} conflict: ${module.id} and ${owner} both use it.`)
    }
  }
  return issues
}

/**
 * Generate a full doctor report.
 * @param packs - loaded packs, each with its modules.
 * @param discovery - discovery results keyed by module id order.
 * @param statuses - current supervisor module statuses.
 * @param approvalService - whether an approval service is present in this dsh process.
 * @param environment - additional environment-wide issue strings.
 * @param backup - per-module backup readiness, in module order.
 * @returns the doctor report.
 */
export function generateDoctor(
  packs: readonly { readonly packageName: string; readonly modules: readonly PackModule[] }[],
  discovery: readonly DiscoveryResult[],
  statuses: readonly ModuleStatus[],
  approvalService: boolean,
  environment: readonly string[] = [],
  backup: readonly DoctorBackup[] = [],
): DoctorReport {
  const modules = buildModules(packs, discovery, statuses)
  const env = [...environment, ...portConflicts(packs)]
  return {
    generatedAt: new Date().toISOString(),
    approvalService,
    packs: packs.map(p => ({ packageName: p.packageName, moduleCount: p.modules.length })),
    modules,
    backup,
    environment: env,
  }
}

