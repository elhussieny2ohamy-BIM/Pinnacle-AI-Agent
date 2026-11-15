/** Client-owned Typert contribution for the Hub's host Remote methods. */

import type {
  InvocationDescriptor,
  RemoteResult,
  TypertCodec,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type { AuditRecord } from '../audit.ts'
import type { SnapshotInfo } from '../backup.ts'
import type { DoctorReport, HubStatus, ModuleStatus, ProbeOutcome } from '../types.ts'

/** The mounted host namespace consumed by the Hub page. */
export interface HubClientRemote {
  status(): Promise<RemoteResult<HubStatus>>
  setEnabled(id: string, enabled: boolean): Promise<RemoteResult<ModuleStatus>>
  probe(id: string): Promise<RemoteResult<ProbeOutcome>>
  doctor(): Promise<RemoteResult<DoctorReport>>
  backups(): Promise<RemoteResult<readonly SnapshotInfo[]>>
  audit(limit?: number): Promise<RemoteResult<readonly AuditRecord[]>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    PINNACLEHub: HubClientRemote
  }
}

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

function parseJson(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError('Remote value contains a cycle.')
    ancestors.add(value)
    const result = value.map(item => parseJson(item, ancestors))
    ancestors.delete(value)
    return result
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Remote value must contain only plain JSON objects.')
    }
    if (ancestors.has(value)) throw new TypeError('Remote value contains a cycle.')
    ancestors.add(value)
    const result: Record<string, JsonValue> = {}
    for (const [key, item] of Object.entries(value)) result[key] = parseJson(item, ancestors)
    ancestors.delete(value)
    return result
  }
  throw new TypeError('Remote value is not JSON serializable.')
}

function codec<Value>(typeSymbol: string, parse: (value: unknown) => Value): TypertCodec<Value> {
  return {
    mode: 'strict',
    typeSymbol,
    create: () => ({ parse }),
  }
}

const jsonCodec = codec<JsonValue>('@PINNACLE/mcp-hub/types#JsonValue', parseJson)
const stringCodec = codec<string>('@PINNACLE/mcp-hub/types#String', value => {
  if (typeof value !== 'string') throw new TypeError('Expected a string.')
  return value
})
const booleanCodec = codec<boolean>('@PINNACLE/mcp-hub/types#Boolean', value => {
  if (typeof value !== 'boolean') throw new TypeError('Expected a boolean.')
  return value
})
const optionalNumberCodec = codec<number | undefined>('@PINNACLE/mcp-hub/types#OptionalNumber', value => {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Expected a finite number.')
  return value
})

interface ParameterSpec {
  readonly name: string
  readonly codec: TypertCodec
  readonly acceptsUndefined?: true
}

function descriptor(method: string, parameters: readonly ParameterSpec[]): InvocationDescriptor {
  return {
    id: `@PINNACLE/mcp-hub#PINNACLEHub/${method}`,
    service: 'PINNACLEHubRemote',
    namespace: 'PINNACLEHub',
    method,
    invocation: { kind: 'direct' },
    parameters: parameters.map(parameter => ({
      name: parameter.name,
      wire: parameter.name,
      source: 'json',
      codec: parameter.codec,
      ...(parameter.acceptsUndefined === true ? { acceptsUndefined: true as const } : {}),
    })),
    result: jsonCodec,
  }
}

/** The explicit client mount makes this Hub's namespace available on the page. */
const hubRemote: TypertRemoteContribution = {
  package: '@PINNACLE/mcp-hub',
  descriptors: [
    descriptor('status', []),
    descriptor('setEnabled', [
      { name: 'id', codec: stringCodec },
      { name: 'enabled', codec: booleanCodec },
    ]),
    descriptor('probe', [{ name: 'id', codec: stringCodec }]),
    descriptor('doctor', []),
    descriptor('backups', []),
    descriptor('audit', [{ name: 'limit', codec: optionalNumberCodec, acceptsUndefined: true }]),
  ],
}

export default hubRemote

