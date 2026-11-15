/**
 * Audit logger for the PINNACLE MCP hub.
 *
 * Writes one JSONL record per write-relevant hub operation to
 * `~/.dsh/pinnacle-hub/audit/YYYY-MM.jsonl` (or `PINNACLE_AUDIT_DIR` when set, which
 * keeps tests and proofs off the user's real log). Each record carries the time,
 * session, agent, module, tool, policy decision, result, and duration.
 * Secret values are redacted before persistence.
 * @module @pinnacle/mcp-hub/src/audit
 */

import { appendFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Fields redacted from audit records. */
const REDACTED_FIELDS = new Set([
  'credential', 'password', 'secret', 'token', 'key', 'apikey', 'api-key',
])

/** Redact secret-like values from an unknown JSON value. */
function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(redact)
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase()
      result[key] = REDACTED_FIELDS.has(lower) || lower.includes('credential')
        ? '[redacted]'
        : redact(val)
    }
    return result
  }
  return value
}

/** Outcome of a backup attempt attached to an audit record. */
export interface AuditBackupInfo {
  /** Snapshot lifecycle result. */
  readonly status: 'created' | 'failed' | 'skipped' | 'unsupported'
  /** Absolute snapshot path, when one was created. */
  readonly path?: string
  /** Snapshot size in bytes, when one was created. */
  readonly bytes?: number
  /** Raw backup tool or copy mode used. */
  readonly tool?: string
  /** Machine-readable reason for a skip or failure. */
  readonly reason?: string
}

/** Audit record shape persisted to JSONL. */
export interface AuditRecord {
  /** ISO timestamp of the event. */
  readonly ts: string
  /** Session id, when available. */
  readonly session?: string
  /** Agent id, when available. */
  readonly agent?: string
  /** Module id the operation targeted. */
  readonly module: string
  /** Tool or action name. */
  readonly tool: string
  /** Policy decision applied. */
  readonly decision: 'allow' | 'deny' | 'ask' | 'error'
  /** Result of the operation. */
  readonly result: 'ok' | 'failed' | 'refused'
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number
  /** Optional human-readable detail. */
  readonly detail?: string
  /** Redacted arguments, when present. */
  readonly args?: unknown
  /** Backup outcome, when the record describes a snapshot attempt. */
  readonly backup?: AuditBackupInfo
}

/** Resolve the monthly audit directory, honoring the `PINNACLE_AUDIT_DIR` override. */
function auditDir(): string {
  const dir = process.env.PINNACLE_AUDIT_DIR ?? join(homedir(), '.dsh', 'pinnacle-hub', 'audit')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Resolve the monthly audit file path under the dsh home directory. */
function auditFilePath(month: string): string {
  return join(auditDir(), `${month}.jsonl`)
}

/**
 * Append one audit record to the current month's JSONL file.
 * @param record - the audit record to persist.
 */
export function auditWrite(record: AuditRecord): void {
  try {
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const line = JSON.stringify({
      ts: record.ts,
      ...(record.session !== undefined ? { session: record.session } : {}),
      ...(record.agent !== undefined ? { agent: record.agent } : {}),
      module: record.module,
      tool: record.tool,
      decision: record.decision,
      result: record.result,
      durationMs: record.durationMs,
      ...(record.detail !== undefined ? { detail: record.detail } : {}),
      ...(record.args !== undefined ? { args: redact(record.args) } : {}),
      ...(record.backup !== undefined ? { backup: record.backup } : {}),
    })
    appendFileSync(auditFilePath(month), line + '\n', { encoding: 'utf8' })
  } catch {
    // Audit must never break the hub: swallow filesystem errors.
  }
}

/** Last N audit records across monthly files, newest first. */
export function auditRead(limit: number): AuditRecord[] {
  const records: AuditRecord[] = []
  const dir = auditDir()
  try {
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .reverse()
    for (const file of files) {
      if (records.length >= limit) break
      const content = readFileSync(join(dir, file), 'utf8')
      for (const line of content.split(/\r?\n/)) {
        if (line.trim().length === 0) continue
        try {
          records.push(JSON.parse(line) as AuditRecord)
          if (records.length >= limit) break
        } catch {
          // Skip corrupt lines.
        }
      }
    }
  } catch {
    // Ignore read errors.
  }
  return records.slice(0, limit)
}

