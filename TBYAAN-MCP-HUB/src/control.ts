/**
 * The `aec_control` tool â€” the only model-facing surface of the PINNACLE MCP hub.
 *
 * Actions:
 * - `status` â€” hub status summary (safe)
 * - `list` â€” module table with states (safe)
 * - `enable <module>` â€” enable a module (write, governed by writeMode)
 * - `disable <module>` â€” disable a module (write, governed by writeMode)
 * - `probe <module>` â€” clean probe of a module (write, governed by writeMode)
 * - `doctor` â€” full diagnosis (safe)
 * - `discover` â€” discovery results with confidence (safe)
 *
 * `writeMode` is never exposed to the model; write actions are governed by the
 * hub's default writeMode through `tools/pre-execute`. `status`/`list`/`doctor`/`discover`
 * are always allowed.
 * @module @PINNACLE/mcp-hub/src/control
 */

import { auditWrite } from './audit.ts'
import { auditRead } from './audit.ts'
import type { AuditRecord } from './audit.ts'
import type { SnapshotInfo } from './backup.ts'
import { readAecArgs } from './policy.ts'
import { errorMessage } from './message.ts'
import type { DoctorReport, HubStatus, ModuleStatus, ProbeOutcome } from './types.ts'

/** The single model-facing tool name. */
export const AEC_CONTROL_NAME = 'aec_control'

/** Shape of the tool's canonical output. Loose enough for all actions. */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    action: { type: 'string' },
    module: { type: 'string' },
    data: {},
  },
  required: ['ok', 'action'],
} as const

/** Render one canonical output value to model-facing content blocks. */
function renderOutput(value: unknown): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/** Structural type for a registered tool definition (matches @deepseek-ai/dsh-tools). */
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): { type: string; text: string }[]
    presentationMeta?(args: unknown, value: unknown): unknown
  }
  execute(args: unknown, exec: unknown): Promise<unknown>
}

/** Structural type for the tool registry's register method. */
export interface ToolRegistry {
  register(definition: ToolDefinition): () => void
}

/**
 * Build the `aec_control` tool definition.
 * @param hub - the published hub service.
 */
export function aecControlDefinition(hub: {
  status(): HubStatus | undefined
  setEnabled(id: string, enabled: boolean): Promise<ModuleStatus>
  probe(id: string, options?: { timeoutMs?: number }): Promise<ProbeOutcome>
  doctor(): Promise<DoctorReport>
  audit(limit?: number): Promise<readonly AuditRecord[]>
  backups(): readonly SnapshotInfo[]
}): ToolDefinition {
  return {
    name: AEC_CONTROL_NAME,
    description:
      'Control the PINNACLE MCP hub. Actions: status (hub summary), list (module table), '
      + 'enable <module> / disable <module> (toggle a module, governed by writeMode), '
      + 'probe <module> (test an MCP server connection), doctor (full diagnosis), '
      + 'discover (discovery results with confidence), audit (recent audit records), '
      + 'backups (retained snapshots per module). status/list/doctor/discover/audit/backups '
      + 'are safe; enable/disable/probe require confirmation under writeMode confirm and are refused under deny.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'Action to perform: status | list | enable | disable | probe | doctor | discover | audit | backups.',
      },
      module: {
        type: 'string',
        description: 'Module id (required for enable, disable, probe; optional filter for audit).',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of audit records to return (audit action only).',
      },
      status: {
        type: 'string',
        description: 'Audit result filter: ok | failed | refused (audit action only).',
      },
    },
    output: {
      schema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      render: (_args: unknown, value: unknown) => renderOutput(value),
    },
    async execute(args: unknown, exec: unknown): Promise<unknown> {
      const { action, module } = readAecArgs(args)
      void exec

      try {
        switch (action) {
          case 'status': {
            const status = hub.status()
            return {
              ok: status !== undefined,
              action,
              data: status === undefined ? 'hub service unavailable' : status,
            }
          }
          case 'list': {
            const status = hub.status()
            return {
              ok: status !== undefined,
              action,
              data: status === undefined ? [] : status.modules,
            }
          }
          case 'enable': {
            if (module === undefined) {
              return { ok: false, action, module, data: 'module is required for enable' }
            }
            const started = Date.now()
            try {
              const status = await hub.setEnabled(module, true)
              auditWrite({ ts: new Date().toISOString(), module, tool: 'enable', decision: 'allow', result: 'ok', durationMs: Date.now() - started })
              return { ok: true, action, module, data: status }
            } catch (error) {
              auditWrite({ ts: new Date().toISOString(), module, tool: 'enable', decision: 'error', result: 'failed', durationMs: Date.now() - started, detail: errorMessage(error) })
              return { ok: false, action, module, data: `error: ${errorMessage(error)}` }
            }
          }
          case 'disable': {
            if (module === undefined) {
              return { ok: false, action, module, data: 'module is required for disable' }
            }
            const started = Date.now()
            try {
              const status = await hub.setEnabled(module, false)
              auditWrite({ ts: new Date().toISOString(), module, tool: 'disable', decision: 'allow', result: 'ok', durationMs: Date.now() - started })
              return { ok: true, action, module, data: status }
            } catch (error) {
              auditWrite({ ts: new Date().toISOString(), module, tool: 'disable', decision: 'error', result: 'failed', durationMs: Date.now() - started, detail: errorMessage(error) })
              return { ok: false, action, module, data: `error: ${errorMessage(error)}` }
            }
          }
          case 'probe': {
            if (module === undefined) {
              return { ok: false, action, module, data: 'module is required for probe' }
            }
            const started = Date.now()
            try {
              const outcome = await hub.probe(module)
              auditWrite({ ts: new Date().toISOString(), module, tool: 'probe', decision: 'allow', result: outcome.ok ? 'ok' : 'failed', durationMs: Date.now() - started })
              return { ok: outcome.ok, action, module, data: outcome }
            } catch (error) {
              auditWrite({ ts: new Date().toISOString(), module, tool: 'probe', decision: 'error', result: 'failed', durationMs: Date.now() - started, detail: errorMessage(error) })
              return { ok: false, action, module, data: `error: ${errorMessage(error)}` }
            }
          }
          case 'doctor': {
            const report = await hub.doctor()
            return { ok: true, action, data: report }
          }
          case 'discover': {
            const status = hub.status()
            return {
              ok: status !== undefined,
              action,
              data: status === undefined ? [] : status.modules.map(m => ({
                id: m.id, title: m.title, state: m.state, detail: m.detail,
                appGate: m.appGate, appRunning: m.appRunning,
              })),
            }
          }
          case 'audit': {
            const a = args as { limit?: number; module?: string; status?: string } | undefined
            const limit = a !== undefined && typeof a.limit === 'number' ? a.limit : 50
            const records = await hub.audit(Math.max(limit, limit * 2))
            const filtered = records.filter(record =>
              (a?.module === undefined || record.module === a.module)
              && (a?.status === undefined || record.result === a.status))
            return { ok: true, action, data: filtered.slice(0, limit) }
          }
          case 'backups': {
            const snapshots = hub.backups()
            const filtered = module === undefined ? snapshots : snapshots.filter(s => s.module === module)
            return { ok: true, action, data: filtered }
          }
          default:
            return {
              ok: false,
              action: action ?? '(none)',
              data: `unknown action: ${action ?? 'missing'}. Use status | list | enable | disable | probe | doctor | discover | audit | backups.`,
            }
        }
      } catch (error) {
        return {
          ok: false,
          action: action ?? '(none)',
          ...(module !== undefined ? { module } : {}),
          data: `error: ${errorMessage(error)}`,
        }
      }
    },
  }
}

