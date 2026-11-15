/**
 * Test-only observer plugin for the Phase 2/3 live proof.
 *
 * Reads the published `PINNACLEHub` service and logs every module status
 * transition plus the full `doctor()` report to JSONL, so the hub's supervisor
 * and discovery can be observed from a live dsh boot without restart.
 *
 * Wired into `~/.dsh/profiles/PINNACLE-test` only. Not part of the tarball.
 * @module PINNACLE-hub-observer
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const OUT = join(homedir(), 'AppData', 'Local', 'Temp', 'opencode', 'phase3-proof.jsonl')
const POLL_MS = 1000

function append(record) {
  try {
    const dir = join(homedir(), 'AppData', 'Local', 'Temp', 'opencode')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(OUT, JSON.stringify(record) + '\n', { flag: 'a' })
  } catch {
    // Best-effort evidence; never break the hub.
  }
}

export const name = 'PINNACLE-hub-observer'
export const inject = ['PINNACLEHub']

export function apply(ctx, config) {
  const hub = ctx.get('PINNACLEHub')
  if (hub === undefined) return
  let previous = ''
  const disabled = new Set()
  let doctorLogged = false

  const snapshot = async () => {
    const modules = (hub.status()?.modules ?? []).map(m => ({
      id: m.id, state: m.state, detail: m.detail, appRunning: m.appRunning,
    }))
    const text = JSON.stringify(modules)
    if (text !== previous) {
      previous = text
      append({ ts: new Date().toISOString(), event: 'modules', modules })
    }
    // Live proof: once a no-app module reaches `connected`, disable it to
    // exercise connected -> disable -> dispose without restarting dsh.
    for (const m of modules) {
      if (m.state === 'connected' && !disabled.has(m.id)) {
        disabled.add(m.id)
        try {
          await hub.setEnabled(m.id, false)
        } catch {
          // Best-effort.
        }
      }
    }
    // Log the doctor report once.
    if (!doctorLogged) {
      doctorLogged = true
      try {
        const report = await hub.doctor()
        append({ ts: new Date().toISOString(), event: 'doctor', report })
      } catch (error) {
        append({ ts: new Date().toISOString(), event: 'doctor', error: String(error) })
      }
    }
  }

  ctx.on('mcp-manager/status', () => void snapshot())

  const handle = setInterval(() => void snapshot(), POLL_MS)
  if (typeof handle === 'object' && handle !== null && typeof handle.unref === 'function') {
    handle.unref()
  }
  void snapshot()
}

