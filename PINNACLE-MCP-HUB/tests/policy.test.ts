/**
 * Unit tests for {@link writePolicyListener} and {@link decide}.
 * @module @pinnacle/mcp-hub/tests/policy
 */

import assert from 'node:assert'
import { describe, it } from 'node:test'
import { writePolicyListener, moduleWriteListener, decide, readAecArgs, SAFE_ACTIONS, WRITE_ACTIONS } from '../src/policy.ts'

function hubStatus(writeMode: 'deny' | 'confirm' | 'allow') {
  return { config: { defaults: { writeMode } } }
}

describe('decide', () => {
  it('deny refuses write', () => {
    const d = decide('deny', true)
    assert.strictEqual(d.kind, 'deny')
    assert.ok(d.reason!.includes('writeMode: deny'))
  })

  it('confirm asks when approval present', () => {
    const d = decide('confirm', true)
    assert.strictEqual(d.kind, 'ask')
    assert.ok(d.reason!.includes('confirm'))
  })

  it('confirm refuses when no approval', () => {
    const d = decide('confirm', false)
    assert.strictEqual(d.kind, 'deny')
    assert.ok(d.reason!.includes('no approval service'))
  })

  it('allow permits write', () => {
    const d = decide('allow', false)
    assert.strictEqual(d.kind, 'allow')
  })
})

describe('writePolicyListener', () => {
  it('allows safe actions without consulting writeMode', async () => {
    const listener = writePolicyListener(() => hubStatus('deny'), false)
    for (const action of SAFE_ACTIONS) {
      const decision = await listener(
        { name: 'aec_control', arguments: { action } },
        async () => ({ kind: 'allow' } as const),
      )
      assert.strictEqual(decision.kind, 'allow', `${action} should be allowed`)
    }
  })

  it('denies write actions under writeMode deny', async () => {
    const listener = writePolicyListener(() => hubStatus('deny'), true)
    for (const action of WRITE_ACTIONS) {
      const decision = await listener(
        { name: 'aec_control', arguments: { action, module: 'rvt' } },
        async () => ({ kind: 'allow' } as const),
      )
      assert.strictEqual(decision.kind, 'deny', `${action} should be denied under writeMode deny`)
    }
  })

  it('asks for write actions under writeMode confirm with approval', async () => {
    const listener = writePolicyListener(() => hubStatus('confirm'), true)
    const decision = await listener(
      { name: 'aec_control', arguments: { action: 'enable', module: 'rvt' } },
      async () => ({ kind: 'allow' } as const),
    )
    assert.strictEqual(decision.kind, 'ask')
  })

  it('allows write actions under writeMode allow', async () => {
    const listener = writePolicyListener(() => hubStatus('allow'), false)
    const decision = await listener(
      { name: 'aec_control', arguments: { action: 'disable', module: 'rvt' } },
      async () => ({ kind: 'allow' } as const),
    )
    assert.strictEqual(decision.kind, 'allow')
  })

  it('passes through non-aec_control calls', async () => {
    const listener = writePolicyListener(() => hubStatus('deny'), true)
    const decision = await listener(
      { name: 'some_other_tool', arguments: {} },
      async () => ({ kind: 'allow' } as const),
    )
    assert.strictEqual(decision.kind, 'allow')
  })

  it('calls next for allowed write actions', async () => {
    let nextCalled = false
    const listener = writePolicyListener(() => hubStatus('allow'), false)
    await listener(
      { name: 'aec_control', arguments: { action: 'enable', module: 'rvt' } },
      async () => { nextCalled = true; return { kind: 'allow' } as const },
    )
    assert.strictEqual(nextCalled, true)
  })

  it('does not call next for denied write actions', async () => {
    let nextCalled = false
    const listener = writePolicyListener(() => hubStatus('deny'), true)
    await listener(
      { name: 'aec_control', arguments: { action: 'enable', module: 'rvt' } },
      async () => { nextCalled = true; return { kind: 'allow' } as const },
    )
    assert.strictEqual(nextCalled, false)
  })
})

describe('moduleWriteListener', () => {
  const identify = (name: string) => {
    if (name === 'mcp__rvt__get_levels') return { moduleId: 'rvt', kind: 'read' as const }
    if (name === 'mcp__rvt__create_wall') return { moduleId: 'rvt', kind: 'write' as const }
    if (name === 'mcp__rhino__rhino_save') return { moduleId: 'rhino', kind: 'backup' as const }
    return undefined
  }

  it('ignores non-module tools', async () => {
    const listener = moduleWriteListener(identify, () => hubStatus('deny'), false)
    const decision = await listener({ name: 'some_other_tool' }, async () => ({ kind: 'allow' } as const))
    assert.strictEqual(decision.kind, 'allow')
  })

  it('leaves aec_control to the control policy', async () => {
    const listener = moduleWriteListener(identify, () => hubStatus('deny'), false)
    const decision = await listener({ name: 'aec_control' }, async () => ({ kind: 'allow' } as const))
    assert.strictEqual(decision.kind, 'allow')
  })

  it('always allows read-only module tools', async () => {
    const listener = moduleWriteListener(identify, () => hubStatus('deny'), false)
    const decision = await listener({ name: 'mcp__rvt__get_levels' }, async () => ({ kind: 'allow' } as const))
    assert.strictEqual(decision.kind, 'allow')
  })

  it('denies a module write under writeMode deny', async () => {
    const listener = moduleWriteListener(identify, () => hubStatus('deny'), false)
    const decision = await listener({ name: 'mcp__rvt__create_wall' }, async () => ({ kind: 'allow' } as const))
    assert.strictEqual(decision.kind, 'deny')
  })

  it('treats the declared backup tool as a governed write', async () => {
    const listener = moduleWriteListener(identify, () => hubStatus('deny'), false)
    const decision = await listener({ name: 'mcp__rhino__rhino_save' }, async () => ({ kind: 'allow' } as const))
    assert.strictEqual(decision.kind, 'deny')
  })

  it('asks for a module write under confirm with approval', async () => {
    const listener = moduleWriteListener(identify, () => hubStatus('confirm'), true)
    const decision = await listener({ name: 'mcp__rvt__create_wall' }, async () => ({ kind: 'allow' } as const))
    assert.strictEqual(decision.kind, 'ask')
  })

  it('allows a module write under writeMode allow', async () => {
    const listener = moduleWriteListener(identify, () => hubStatus('allow'), false)
    let nextCalled = false
    const decision = await listener(
      { name: 'mcp__rvt__create_wall' },
      async () => { nextCalled = true; return { kind: 'allow' } as const },
    )
    assert.strictEqual(decision.kind, 'allow')
    assert.strictEqual(nextCalled, true)
  })
})

describe('readAecArgs', () => {
  it('parses action and module', () => {
    const { action, module } = readAecArgs({ action: 'enable', module: 'rvt' })
    assert.strictEqual(action, 'enable')
    assert.strictEqual(module, 'rvt')
  })

  it('handles missing fields', () => {
    const { action, module } = readAecArgs({})
    assert.strictEqual(action, undefined)
    assert.strictEqual(module, undefined)
  })

  it('handles null and non-objects', () => {
    assert.deepStrictEqual(readAecArgs(null), { action: undefined, module: undefined })
    assert.deepStrictEqual(readAecArgs('string'), { action: undefined, module: undefined })
    assert.deepStrictEqual(readAecArgs(42), { action: undefined, module: undefined })
  })

  it('ignores non-string action and module', () => {
    const { action, module } = readAecArgs({ action: 123, module: true })
    assert.strictEqual(action, undefined)
    assert.strictEqual(module, undefined)
  })
})

