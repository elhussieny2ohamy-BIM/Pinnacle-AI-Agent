/**
 * Client-side face for the PINNACLE MCP hub remote.
 *
 * Wraps `ctx.remote.pinnacleHub` (the Typert Gateway binding to the host-side
 * `pinnacleHubRemote`) into a plain object of async methods the page components
 * call. The face is registered through the main slot's `inject` so components
 * receive it through `InjectFace<HubPanelFace>` without touching `ctx`.
 * @module @pinnacle/mcp-hub/src/client/HubClient
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { SnapshotInfo } from '../../src/backup.ts'
import type { DoctorReport, HubStatus, ModuleStatus, ProbeOutcome } from '../../src/types.ts'
import type { HubClientRemote } from './remote.ts'

/** Face exposed to page components: read hub state, toggle modules, probe servers. */
export interface HubPanelFace {
  /** Hub status summary (packs, module states, config). */
  status: () => Promise<HubStatus>
  /** Enable or disable one module; governed by writeMode on the host. */
  setEnabled: (id: string, enabled: boolean) => Promise<ModuleStatus>
  /** Probe one module's MCP server; a failed probe is a value, not a throw. */
  probe: (id: string) => Promise<ProbeOutcome>
  /** Full diagnosis: modules, backup readiness, environment issues. */
  doctor: () => Promise<DoctorReport>
  /** Retained snapshots per module. */
  backups: () => Promise<readonly SnapshotInfo[]>
}

/** Convert Gateway results into the page's ordinary success/throw contract. */
function unwrap<T>(result: Awaited<ReturnType<HubClientRemote[keyof HubClientRemote]>>): T {
  if (result !== null && typeof result === 'object' && 'ok' in result) {
    if (result.ok) return result.value as T
    throw new Error(`${result.error.code}: ${result.error.message}`)
  }
  throw new Error('The hub Remote returned an invalid result.')
}

/** Build the face over the host's `pinnacleHub` Typert remote namespace. */
export function createHubClient(ctx: ClientContext): HubPanelFace {
  // `ctx.remote` is the Cordis client remote service; `pinnacleHub` is the
  // Typert Gateway namespace bound by the host-side `pinnacleHubRemote`.
  const hub = (ctx as ClientContext & { remote: TypertClientRemote }).remote.pinnacleHub
  return {
    status: async () => unwrap<HubStatus>(await hub.status()),
    setEnabled: async (id, enabled) => unwrap<ModuleStatus>(await hub.setEnabled(id, enabled)),
    probe: async id => unwrap<ProbeOutcome>(await hub.probe(id)),
    doctor: async () => unwrap<DoctorReport>(await hub.doctor()),
    backups: async () => unwrap<readonly SnapshotInfo[]>(await hub.backups()),
  }
}

