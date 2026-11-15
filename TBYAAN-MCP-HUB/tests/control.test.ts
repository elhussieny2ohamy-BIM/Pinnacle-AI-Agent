/**
 * Unit tests for {@link aecControlDefinition}.
 * @module @PINNACLE/mcp-hub/tests/control
 */

import assert from 'node:assert'
import { describe, it } from 'node:test'
import { aecControlDefinition, AEC_CONTROL_NAME } from '../src/control.ts'

function fakeHub(modules: { id: string; state: string; detail: string }[] = []): any {
  return {
    status: () => ({
      startedAt: '2026-01-01T00:00:00Z',
      config: { packs: [], discovery: { applyMode: 'confirm' as const }, defaults: { profile: 'coordination', writeMode: 'deny' as const, maxVisibleTools: 120, pollMs: 20_000 } },
      packs: [],
      modules,
      stopped: false,
    }),
    setEnabled: async (_id: string, enabled: boolean) => ({
      id: _id, title: _id, state: enabled ? 'starting' : 'disabled', detail: enabled ? 'Registered; waiting.' : 'Disabled.',
      appGate: false, appRunning: false, since: '2026-01-01T00:00:00Z',
    }),
    probe: async (_id: string) => ({ ok: true, stage: 'connect' as const, durationMs: 100, toolCount: 3 }),
    doctor: async () => ({ generatedAt: '2026-01-01T00:00:00Z', approvalService: false, packs: [], modules: [], backup: [], environment: [] }),
    audit: async (limit: number) => ([
      { ts: '2026-01-01T00:00:00Z', module: 'rvt', tool: 'enable', decision: 'allow' as const, result: 'ok' as const, durationMs: 1 },
      { ts: '2026-01-01T00:00:01Z', module: 'rhino', tool: 'mcp__rhino__rhino_save', decision: 'deny' as const, result: 'refused' as const, durationMs: 1 },
    ]).slice(0, limit),
    backups: () => ([
      { module: 'rhino', path: 'C:\\backups\\rhino\\a.3dm', bytes: 10, modifiedAt: '2026-01-01T00:00:00Z' },
      { module: 'rvt', path: 'C:\\backups\\rvt\\b.rvt', bytes: 20, modifiedAt: '2026-01-01T00:00:01Z' },
    ]),
  }
}

describe('aecControlDefinition', () => {
  it('has the correct tool name', () => {
    const def = aecControlDefinition(fakeHub() as any)
    assert.strictEqual(def.name, AEC_CONTROL_NAME)
  })

  it('status returns hub status', async () => {
    const def = aecControlDefinition(fakeHub() as any)
    const result = await def.execute({ action: 'status' }, {}) as { ok: boolean; action: string; data: unknown }
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.action, 'status')
    assert.ok(result.data)
  })

  it('list returns modules', async () => {
    const def = aecControlDefinition(fakeHub([{ id: 'rvt', state: 'connected', detail: 'ok' }]))
    const result = await def.execute({ action: 'list' }, {}) as { ok: boolean; action: string; data: unknown[] }
    assert.strictEqual(result.ok, true)
    assert.strictEqual(Array.isArray(result.data), true)
    assert.strictEqual(result.data.length, 1)
  })

  it('enable requires module', async () => {
    const def = aecControlDefinition(fakeHub() as any)
    const result = await def.execute({ action: 'enable' }, {}) as { ok: boolean; data: string }
    assert.strictEqual(result.ok, false)
    assert.ok(result.data.includes('module is required'))
  })

  it('enable succeeds and returns status', async () => {
    const def = aecControlDefinition(fakeHub() as any)
    const result = await def.execute({ action: 'enable', module: 'rvt' }, {}) as { ok: boolean; module: string; data: { state: string } }
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.module, 'rvt')
    assert.strictEqual(result.data.state, 'starting')
  })

  it('disable succeeds', async () => {
    const def = aecControlDefinition(fakeHub() as any)
    const result = await def.execute({ action: 'disable', module: 'rvt' }, {}) as { ok: boolean; data: { state: string } }
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.data.state, 'disabled')
  })

  it('probe requires module', async () => {
    const def = aecControlDefinition(fakeHub() as any)
    const result = await def.execute({ action: 'probe' }, {}) as { ok: boolean; data: string }
    assert.strictEqual(result.ok, false)
    assert.ok(result.data.includes('module is required'))
  })

  it('probe returns outcome', async () => {
    const def = aecControlDefinition(fakeHub() as any)
    const result = await def.execute({ action: 'probe', module: 'rvt' }, {}) as { ok: boolean; data: { toolCount: number } }
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.data.toolCount, 3)
  })

  it('doctor returns report', async () => {
    const def = aecControlDefinition(fakeHub() as any)
    const result = await def.execute({ action: 'doctor' }, {}) as { ok: boolean; action: string; data: { generatedAt: string } }
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.action, 'doctor')
    assert.ok(result.data.generatedAt)
  })

  it('discover returns module list', async () => {
    const def = aecControlDefinition(fakeHub([{ id: 'rvt', state: 'connected', detail: 'ok' }]))
    const result = await def.execute({ action: 'discover' }, {}) as { ok: boolean; data: unknown[] }
    assert.strictEqual(result.ok, true)
    assert.ok(Array.isArray(result.data))
    assert.strictEqual(result.data.length, 1)
  })

  it('unknown action returns error', async () => {
    const def = aecControlDefinition(fakeHub() as any)
    const result = await def.execute({ action: 'bogus' }, {}) as { ok: boolean; data: string }
    assert.strictEqual(result.ok, false)
    assert.ok(result.data.includes('unknown action'))
  })

  it('audit filters records by module and status', async () => {
    const def = aecControlDefinition(fakeHub() as any)
    const byModule = await def.execute({ action: 'audit', module: 'rhino' }, {}) as { data: { module: string }[] }
    assert.strictEqual(byModule.data.length, 1)
    assert.strictEqual(byModule.data[0]!.module, 'rhino')
    const refused = await def.execute({ action: 'audit', status: 'refused' }, {}) as { data: { result: string }[] }
    assert.strictEqual(refused.data.length, 1)
    assert.strictEqual(refused.data[0]!.result, 'refused')
  })

  it('backups lists retained snapshots and filters by module', async () => {
    const def = aecControlDefinition(fakeHub() as any)
    const all = await def.execute({ action: 'backups' }, {}) as { ok: boolean; data: unknown[] }
    assert.strictEqual(all.ok, true)
    assert.strictEqual(all.data.length, 2)
    const only = await def.execute({ action: 'backups', module: 'rhino' }, {}) as { data: { module: string }[] }
    assert.strictEqual(only.data.length, 1)
    assert.strictEqual(only.data[0]!.module, 'rhino')
  })

  it('missing action returns error', async () => {
    const def = aecControlDefinition(fakeHub() as any)
    const result = await def.execute({}, {}) as { ok: boolean; data: string }
    assert.strictEqual(result.ok, false)
    assert.ok(result.data.includes('missing'))
  })
})

