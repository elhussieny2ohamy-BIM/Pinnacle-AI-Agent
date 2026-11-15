/**
 * Host-side Typert remote for the PINNACLE MCP hub.
 *
 * Exposes the hub service's read-only and write-governed methods to the web
 * client so the Modules and Doctor screens can toggle modules, probe servers,
 * and read status/doctor/backups without touching the terminal. The remote is
 * constructed by the hub's `apply` and registers itself as a Cordis service
 * plus a Typert Gateway binding under the `pinnacleHub` namespace.
 *
 * Write actions (`enable`, `disable`, `probe`) remain governed by the hub's
 * `writeMode` policy â€” the remote enforces nothing itself, it simply forwards
 * to the hub service which applies policy through `tools/pre-execute`.
 * @module @pinnacle/mcp-hub/src/remote
 */

import { bindTypertRemote, type RemoteMethodMarker } from '@deepseek-ai/dsh-typert-protocol'
import type { AuditRecord } from './audit.ts'
import type { SnapshotInfo } from './backup.ts'
import type { HubService } from './index.ts'
import type { DoctorReport, HubStatus, ModuleStatus, ProbeOutcome } from './types.ts'

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/** Cordis service key under which the remote registers. Not the Typert namespace. */
export const REMOTE_SERVICE_KEY = 'pinnacleHubRemote'

/** Typert Gateway namespace clients call into: `ctx.remote.pinnacleHub.<method>()`. */
const REMOTE_NAMESPACE = 'pinnacleHub'

/** Minimal surface of the hub service the remote forwards to. */
/** One Remote method marker matching what the decorator would attach. */
interface StoredRemoteMethod extends RemoteMethodMarker {
  readonly method: string
}

/** Register one method as a direct Remote endpoint on the class prototype. */
function markRemoteMethod(prototype: object, method: string): void {
  const descriptor = (prototype as any)[REMOTE_METHOD_DESCRIPTOR] as
    | { version: number; methods: readonly StoredRemoteMethod[] }
    | undefined
  const marker: StoredRemoteMethod = Object.freeze({
    method,
    invocation: Object.freeze({ kind: 'direct' }),
  })
  const current = descriptor?.methods.find(c => c.method === method)
  if (current !== undefined && current.exportName === marker.exportName) {
    return
  }
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze([...(descriptor?.methods ?? []), marker]),
    }),
  })
}

/**
 * Host remote forwarding hub service calls to the Typert Gateway.
 * Constructed by {@link apply} in {@link ./index.ts}; not registered as a
 * separate cordis.patch.yml row to avoid a duplicate-service conflict with the
 * hub's own `pinnacleHub` provision.
 * @module @pinnacle/mcp-hub/src/remote
 */
export class pinnacleHubRemote {
  private readonly hub: HubService
  private readonly runControlAction: (action: 'enable' | 'disable' | 'probe', id: string) => Promise<unknown>

  constructor(
    hub: HubService,
    runControlAction: (action: 'enable' | 'disable' | 'probe', id: string) => Promise<unknown>,
  ) {
    this.hub = hub
    this.runControlAction = runControlAction

    // The host registers this instance under REMOTE_SERVICE_KEY after construction.
    const gatewayBinding = bindTypertRemote(this, REMOTE_SERVICE_KEY, { namespace: REMOTE_NAMESPACE })
    // Attach the binding object on the instance so Gateway's `ctx.reflect.props`
    // scan can read `typertRemote`.
    ;(this as any).typertRemote = gatewayBinding

    // Mark public instance methods as direct Remote endpoints so Gateway
    // reflection (`remoteMethods`) discovers them. These markers are what the
    // `@Remote` decorator would attach; manual marks are equivalent.
    const proto = Object.getPrototypeOf(this)
    markRemoteMethod(proto, 'status')
    markRemoteMethod(proto, 'setEnabled')
    markRemoteMethod(proto, 'probe')
    markRemoteMethod(proto, 'doctor')
    markRemoteMethod(proto, 'backups')
    markRemoteMethod(proto, 'audit')
  }

  /** Hub status summary: started config, packs, module states. Safe. */
  status(): Promise<HubStatus> {
    return Promise.resolve(this.hub.status())
  }

  /** Enable or disable one module; governed by writeMode. */
  async setEnabled(id: string, enabled: boolean): Promise<ModuleStatus> {
    const action = enabled ? 'enable' : 'disable'
    return await this.runWriteAction(action, id) as ModuleStatus
  }

  /** Probe one module's MCP server; a failed probe is a value, not a throw. */
  async probe(id: string): Promise<ProbeOutcome> {
    return await this.runWriteAction('probe', id) as ProbeOutcome
  }

  /** Full diagnosis: modules, backup readiness, environment issues. Safe. */
  doctor(): Promise<DoctorReport> {
    return this.hub.doctor()
  }

  /** Retained snapshots per module. Safe. */
  backups(): readonly SnapshotInfo[] {
    return this.hub.backups()
  }

  /** Last N audit records, optionally filtered by module/result. Safe. */
  audit(limit?: number): Promise<readonly AuditRecord[]> {
    return this.hub.audit(limit)
  }

  /** Route every UI write through the same pre-execute policy as aec_control. */
  private async runWriteAction(action: 'enable' | 'disable' | 'probe', id: string): Promise<unknown> {
    const result = await this.runControlAction(action, id) as { ok?: unknown; data?: unknown } | undefined
    if (result === undefined || result === null || typeof result !== 'object' || !('data' in result)) {
      throw new Error(`The hub returned no result for ${action}.`)
    }
    if (result.ok !== true && action !== 'probe') {
      throw new Error(typeof result.data === 'string' ? result.data : `The hub could not ${action} ${id}.`)
    }
    return result.data
  }
}

export default pinnacleHubRemote

