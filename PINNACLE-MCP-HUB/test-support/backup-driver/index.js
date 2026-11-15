/**
 * Test-only Phase 5 backup driver.
 *
 * Waits for the probe pack's `echo` module to register its MCP tools, then
 * dispatches four calls through the real tool pipeline so the hub's policy and
 * snapshot hooks run exactly as they do for the model:
 *
 *  1. `echo_read`  â€” read-only: no snapshot may be taken.
 *  2. `echo_write` â€” write: a snapshot must exist before the body runs.
 *  3. `echo_write` â€” second write: `backup.dedupeMs` decides reuse vs. new.
 *  4. `echo_save`  â€” the declared snapshot tool: governed, never snapshotted.
 *
 * Each step plus the doctor backup report and the retained snapshot list is
 * appended to `phase5-proof.jsonl` under the approved temp directory. Not part
 * of the shipping tarball.
 * @module pinnacle-backup-driver
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const TEMP_DIR = join(homedir(), 'AppData', 'Local', 'Temp', 'opencode')
const OUT = join(TEMP_DIR, 'phase5-proof.jsonl')
const POLL_MS = 500
const MAX_WAIT_MS = 90_000

function append(record) {
  try {
    if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true })
    appendFileSync(OUT, JSON.stringify(record) + '\n')
  } catch {
    // Best-effort evidence; never break the host.
  }
}

function textOf(result) {
  const content = result?.content
  if (!Array.isArray(content)) return ''
  return content
    .map(part => (typeof part?.text === 'string' ? part.text : ''))
    .filter(part => part.length > 0)
    .join(' ')
}

function writeLogLines() {
  const path = process.env.ECHO_WRITE_LOG
  if (path === undefined || !existsSync(path)) return []
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line.length > 0)
}

export const name = 'pinnacle-backup-driver'
export const inject = ['pinnacleHub', 'tools']

export function apply(ctx, config) {
  const hub = ctx.get('pinnacleHub')
  if (hub === undefined) return
  const label = process.env.PINNACLE_PROOF_LABEL ?? (typeof config?.label === 'string' ? config.label : 'normal')
  let started = false
  let waited = 0

  const getTools = () => {
    try { return ctx.get('tools') } catch { return undefined }
  }

  const ready = () => {
    const tool = getTools()?.executable?.('mcp__echo__echo_write')
    if (tool === undefined) return false
    const status = hub.status()
    return (status?.modules ?? []).some(m => m.id === 'echo' && m.state === 'connected')
  }

  const call = async (name, args) => {
    const before = hub.backups().filter(s => s.module === 'echo').length
    try {
      const batch = await getTools().execute({
        calls: [{
          type: 'tool-call',
          id: `phase5-${label}-${name}-${Date.now()}`,
          name,
          arguments: JSON.stringify(args ?? {}),
        }],
        signal: new AbortController().signal,
      })
      const result = batch?.results?.[0]?.result
      const snapshots = hub.backups().filter(s => s.module === 'echo')
      const record = {
        ts: new Date().toISOString(),
        phase: 'call',
        label,
        call: name,
        isError: result?.isError === true,
        text: textOf(result),
        snapshotsBefore: before,
        snapshotsAfter: snapshots.length,
        newestSnapshot: snapshots[0]?.path ?? null,
        newestSnapshotBytes: snapshots[0]?.bytes ?? null,
        writeLog: writeLogLines(),
      }
      append(record)
      return record
    } catch (error) {
      append({
        ts: new Date().toISOString(),
        phase: 'call',
        label,
        call: name,
        thrown: String(error),
        writeLog: writeLogLines(),
      })
      return undefined
    }
  }

  const run = async () => {
    started = true
    append({ ts: new Date().toISOString(), phase: 'start', label, modules: hub.status()?.modules ?? [] })
    try {
      const doctor = await hub.doctor()
      append({ ts: new Date().toISOString(), phase: 'doctor', label, backup: doctor.backup })
    } catch (error) {
      append({ ts: new Date().toISOString(), phase: 'doctor', label, error: String(error) })
    }

    await call('mcp__echo__echo_read', {})
    await call('mcp__echo__echo_write', { value: 'first' })
    await call('mcp__echo__echo_write', { value: 'second' })
    await call('mcp__echo__echo_save', {})

    try {
      const doctor = await hub.doctor()
      append({ ts: new Date().toISOString(), phase: 'final', label, backup: doctor.backup })
    } catch (error) {
      append({ ts: new Date().toISOString(), phase: 'final', label, error: String(error) })
    }
    append({
      ts: new Date().toISOString(),
      phase: 'snapshots',
      label,
      snapshots: hub.backups().filter(s => s.module === 'echo'),
      writeLog: writeLogLines(),
    })
  }

  const timer = setInterval(() => {
    if (started) return
    waited += POLL_MS
    if (waited > MAX_WAIT_MS) {
      started = true
      append({ ts: new Date().toISOString(), phase: 'timeout', label, modules: hub.status()?.modules ?? [], toolsReady: getTools() !== undefined })
      clearInterval(timer)
      return
    }
    if (!ready()) return
    clearInterval(timer)
    void run()
  }, POLL_MS)
  if (typeof timer.unref === 'function') timer.unref()
}

