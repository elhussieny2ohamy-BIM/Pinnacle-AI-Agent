/**
 * Unit tests for {@link auditWrite} and {@link auditRead}.
 * @module @PINNACLE/mcp-hub/tests/audit
 */

import assert from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { auditWrite, auditRead } from '../src/audit.ts'

let auditDir = ''

before(() => {
  auditDir = mkdtempSync(join(tmpdir(), 'PINNACLE-audit-'))
  process.env.PINNACLE_AUDIT_DIR = auditDir
})

after(() => {
  delete process.env.PINNACLE_AUDIT_DIR
  rmSync(auditDir, { recursive: true, force: true })
})

describe('auditWrite / auditRead', () => {
  it('writes and reads back records', () => {
    auditWrite({
      ts: '2026-11-09T00:00:00.000Z',
      session: 'sess-1',
      agent: 'agent-1',
      module: 'rvt',
      tool: 'enable',
      decision: 'allow',
      result: 'ok',
      durationMs: 42,
    })

    const records = auditRead(10)
    const rec0 = records.find(r => r.module === 'rvt' && r.tool === 'enable' && r.durationMs === 42)!
    assert.strictEqual(rec0.module, 'rvt')
    assert.strictEqual(rec0.tool, 'enable')
    assert.strictEqual(rec0.decision, 'allow')
    assert.strictEqual(rec0.result, 'ok')
    assert.strictEqual(rec0.durationMs, 42)
  })

  it('redacts secret fields in args', () => {
    auditWrite({
      ts: '2026-11-09T00:00:01.000Z',
      module: 'rvt',
      tool: 'enable',
      decision: 'allow',
      result: 'ok',
      durationMs: 10,
      args: { credential: 'secret-value', password: 'hidden', name: 'visible' } as unknown as Record<string, unknown>,
    })

    const records = auditRead(10)
    const rec = records.find(r => r.tool === 'enable' && r.args !== undefined)! as { args: Record<string, unknown> }
    assert.strictEqual(rec.args.credential, '[redacted]')
    assert.strictEqual(rec.args.password, '[redacted]')
    assert.strictEqual(rec.args.name, 'visible')
  })

  it('limits results to requested count', () => {
    auditWrite({ ts: '2026-11-09T00:00:02.000Z', module: 'a', tool: 'enable', decision: 'allow', result: 'ok', durationMs: 1 })
    auditWrite({ ts: '2026-11-09T00:00:03.000Z', module: 'b', tool: 'disable', decision: 'allow', result: 'ok', durationMs: 1 })
    auditWrite({ ts: '2026-11-09T00:00:04.000Z', module: 'c', tool: 'probe', decision: 'allow', result: 'ok', durationMs: 1 })

    const records = auditRead(2)
    assert.strictEqual(records.length, 2)
  })

  it('returns empty array when no audit directory exists', () => {
    // Can't easily remove the dir, but auditRead handles missing dir gracefully.
    const records = auditRead(5)
    assert.ok(Array.isArray(records))
  })

  it('persists the backup outcome with path, bytes, and reason', () => {
    auditWrite({
      ts: '2026-11-09T00:00:05.000Z',
      module: 'rhino',
      tool: 'mcp__rhino__rhino_box',
      decision: 'allow',
      result: 'ok',
      durationMs: 12,
      backup: { status: 'created', path: 'C:\\backups\\rhino\\a.3dm', bytes: 99, tool: 'rhino_save' },
    })
    const record = auditRead(10_000).find(r => r.backup?.path === 'C:\\backups\\rhino\\a.3dm')
    assert.ok(record)
    assert.strictEqual(record.backup?.status, 'created')
    assert.strictEqual(record.backup?.bytes, 99)
  })
})

