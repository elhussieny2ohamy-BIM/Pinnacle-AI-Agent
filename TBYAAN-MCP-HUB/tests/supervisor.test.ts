/**
 * Unit tests for {@link Supervisor}: state transitions, disposer idempotence,
 * poll-timer lifetime tied to an enabled gate, and probe paths.
 * @module @PINNACLE/mcp-hub/tests/supervisor
 */

import assert from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import type { ManagerPort, ModuleSpec, SupervisorTimers } from '../src/supervisor.ts'
import { Supervisor } from '../src/supervisor.ts'

/** Probe outcome helper: ok=true manager probe. */
function okProbe(toolCount: number, durationMs = 300): { ok: true; toolNames: readonly string[]; truncated: boolean; durationMs: number; closeConfirmed: boolean } {
  return {
    ok: true,
    toolNames: Array.from({ length: toolCount }, (_, i) => `tool${i}`),
    truncated: false,
    durationMs,
    closeConfirmed: true,
  }
}

function failureProbe(message: string, durationMs = 100): { ok: false; stage: 'connect' | 'list'; message: string; durationMs: number; closeConfirmed: boolean } {
  return { ok: false, stage: 'connect', message, durationMs, closeConfirmed: true }
}

function baseModules(count = 1): ModuleSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `module-${i}`,
    title: `Module ${i}`,
    enabled: true,
    requiresApp: false,
    processNames: [],
    entry: { transport: 'stdio', command: 'node', args: ['-e', 'console.log("hi")'] },
  }))
}

describe('Supervisor', () => {
  it('starts every module disabled and keeps the gate off until an app is declared', async () => {
    const fakeTimers: SupervisorTimers = {
      setInterval: (callback, ms) => setInterval(callback, ms) as unknown,
      clearInterval: h => clearInterval(h as ReturnType<typeof setInterval>),
      setTimeout: (callback, ms) => setTimeout(callback, ms) as unknown,
      clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
    }
    const supervisor = new Supervisor({
      modules: baseModules(2),
      pollMs: 20_000,
      timers: fakeTimers,
    })
    const initial = supervisor.snapshot()
    assert.strictEqual(initial.length, 2)
    for (const status of initial) {
      assert.strictEqual(status.state, 'disabled')
      assert.strictEqual(status.appGate, false)
      assert.strictEqual(status.appRunning, false)
      assert.strictEqual(status.detail, 'The supervisor has not started.')
    }
    const manager: ManagerPort = { register: () => () => undefined }
    supervisor.attachManager(manager)
    await supervisor.start()
    await new Promise(r => setTimeout(r, 50))
    for (const status of supervisor.snapshot()) {
      assert.strictEqual(status.state, 'starting')
      assert.strictEqual(status.appGate, false)
    }
    assert.strictEqual(supervisor.polling(), false)
    supervisor.stop()
  })

  it('transitions enabled modules to connected when the manager reports connected', async () => {
    const manager: ManagerPort = {
      register: () => () => undefined,
      probe: async () => okProbe(3),
    }
    const supervisor = new Supervisor({ modules: baseModules(1), manager, pollMs: 50 })
    supervisor.attachManager(manager)
    await supervisor.start()
    supervisor.handleStatus('module-0', { state: 'connected', toolCount: 3, connectedAt: Date.now() })
    await new Promise(r => setTimeout(r, 50))
    const status = supervisor.snapshot()[0]!
    assert.strictEqual(status.state, 'connected')
    assert.strictEqual(status.detail, '3 tools available.')
    supervisor.stop()
  })

  it('polls while a gate is enabled and stops when the last gate is disabled', async () => {
    const fakeTimers: SupervisorTimers = {
      setInterval: () => setInterval(() => {}, 1) as unknown,
      clearInterval: h => clearInterval(h as ReturnType<typeof setInterval>),
      setTimeout: () => setTimeout(() => {}, 1) as unknown,
      clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
    }
    const manager: ManagerPort = { register: () => () => undefined }
    const gate = { running: async () => new Set<string>() }
    const supervisor = new Supervisor({
      modules: [gatedModule('gate-module')],
      pollMs: 50,
      manager,
      appGate: gate,
      timers: fakeTimers,
    })
    supervisor.attachManager(manager)
    await supervisor.start()
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(supervisor.polling(), true)
    await supervisor.setEnabled('gate-module', false)
    assert.strictEqual(supervisor.polling(), false)
    assert.strictEqual(supervisor.snapshot()[0]!.state, 'disabled')
    supervisor.stop()
  })

  it('reports app_not_running while the gate finds nothing', async () => {
    const manager: ManagerPort = { register: () => () => undefined }
    const gate = { running: async () => new Set<string>() }
    const supervisor = new Supervisor({
      modules: [{ ...baseModules(1)[0]!, id: 'revit', requiresApp: true, processNames: ['revit.exe'] }],
      pollMs: 20,
      manager,
      appGate: gate,
    })
    supervisor.attachManager(manager)
    await supervisor.start()
    await new Promise(r => setTimeout(r, 50))
    const status = supervisor.snapshot()[0]!
    assert.strictEqual(status.state, 'app_not_running')
    assert.strictEqual(status.appGate, true)
    assert.strictEqual(status.appRunning, false)
    assert.ok(status.detail.includes('revit.exe'))
    supervisor.stop()
  })

  it('attaches to the manager after start when it is not present yet', async () => {
    const manager: ManagerPort = { register: () => () => undefined }
    const supervisor = new Supervisor({ modules: baseModules(1), pollMs: 50 })
    await supervisor.start()
    supervisor.attachManager(manager)
    await new Promise(r => setTimeout(r, 0))
    supervisor.handleStatus('module-0', { state: 'connected', toolCount: 1, connectedAt: Date.now() })
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(supervisor.snapshot()[0]!.state, 'connected')
    supervisor.stop()
  })

  it('leaves disabled modules alone even when the gate finds them', async () => {
    const manager: ManagerPort = { register: () => { throw new Error('must not register') } }
    const gate = { running: async () => new Set(['revit.exe']) }
    const supervisor = new Supervisor({
      modules: [{ ...baseModules(1)[0]!, id: 'revit-disabled', enabled: false, requiresApp: true, processNames: ['revit.exe'] }],
      pollMs: 20,
      manager,
      appGate: gate,
    })
    supervisor.attachManager(manager)
    await supervisor.start()
    await new Promise(r => setTimeout(r, 50))
    const status = supervisor.snapshot()[0]!
    assert.strictEqual(status.state, 'disabled')
    assert.strictEqual(status.appGate, true)
    assert.strictEqual(status.appRunning, true)
    supervisor.stop()
  })

  function gatedModule(id: string): ModuleSpec {
    return { ...baseModules(1)[0]!, id, title: baseModules(1)[0]!.title, requiresApp: true, processNames: ['revit.exe'] }
  }

  it('rejects unknown module ids and names known modules', async () => {
    const manager: ManagerPort = { register: () => () => undefined }
    const supervisor = new Supervisor({ modules: baseModules(1), manager, pollMs: 50 })
    supervisor.attachManager(manager)
    await supervisor.start()
    await assert.rejects(() => supervisor.setEnabled('nope', true), /known modules: module-0/)
    await assert.rejects(async () => await supervisor.probe('nope'), /known modules: module-0/)
    supervisor.stop()
  })

  it('disposer idempotence: disabling then re-enabling re-registers', async () => {
    const calls: string[] = []
    const manager: ManagerPort = {
      register: () => { calls.push('register'); return () => { calls.push('dispose') } },
    }
    const supervisor = new Supervisor({ modules: baseModules(1), manager, pollMs: 50 })
    supervisor.attachManager(manager)
    await supervisor.start()
    await supervisor.setEnabled('module-0', false)
    assert.deepStrictEqual(calls, ['register', 'dispose'])
    await supervisor.setEnabled('module-0', true)
    assert.deepStrictEqual(calls, ['register', 'dispose', 'register'])
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(supervisor.snapshot()[0]!.state, 'starting')
    supervisor.stop()
  })

  it('errors when registration throws instead of silently staying disabled', async () => {
    const manager: ManagerPort = {
      register: () => { throw new Error('transport locked') },
    }
    const supervisor = new Supervisor({ modules: baseModules(1), manager, pollMs: 50 })
    supervisor.attachManager(manager)
    await supervisor.start()
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(supervisor.snapshot()[0]!.state, 'error')
    assert.ok(supervisor.snapshot()[0]!.detail.includes('transport locked'))
    supervisor.stop()
  })

  it('probe live module uses manager.probe without touching registration', async () => {
    let probeCalls = 0
    const manager: ManagerPort = {
      register: () => () => undefined,
      probe: async (name, options) => {
        probeCalls++
        assert.ok(signalOption === undefined || options?.signal === signalOption)
        return okProbe(4)
      },
    }
    const supervisor = new Supervisor({ modules: baseModules(1), manager, pollMs: 50 })
    supervisor.attachManager(manager)
    await supervisor.start()
    await new Promise(r => setTimeout(r, 50))
    let signalOption: AbortSignal | undefined
    const controller = new AbortController()
    signalOption = controller.signal
    const result = await supervisor.probe('module-0', { signal: controller.signal })
    assert.strictEqual(probeCalls, 1)
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.toolCount, 4)
    assert.strictEqual(result.stage, 'connect')
    assert.strictEqual(result.message, undefined)
    supervisor.stop()
  })

  it('probe dormant module registers temporarily then disposes', async () => {
    const calls: string[] = []
    const manager: ManagerPort = {
      register: () => { calls.push('register'); return () => { calls.push('dispose') } },
      probe: async () => okProbe(2),
    }
    const supervisor = new Supervisor({
      modules: [{ ...baseModules(1)[0]!, enabled: false }],
      manager,
      pollMs: 50,
    })
    supervisor.attachManager(manager)
    await supervisor.start()
    assert.strictEqual(supervisor.snapshot()[0]!.state, 'disabled')
    const result = await supervisor.probe('module-0')
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.toolCount, 2)
    assert.deepStrictEqual(calls, ['register', 'dispose'])
    // Probing a dormant module ends with no registration left behind and the
    // disabled intent is preserved.
    assert.strictEqual(supervisor.snapshot()[0]!.state, 'disabled')
    supervisor.stop()
  })

  it('probe failure is a value with stage and message, not a throw', async () => {
    const manager: ManagerPort = { register: () => () => undefined }
    const supervisor = new Supervisor({ modules: baseModules(1), manager, pollMs: 50 })
    supervisor.attachManager(manager)
    await supervisor.start()
    // No manager.probe and nothing connected -> awaiting terminal status times out.
    const result = await supervisor.probe('module-0', { timeoutMs: 40 })
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.stage, 'timeout')
    assert.ok(result.message!.includes('timed out'))
    assert.strictEqual(result.durationMs >= 40, true)
    supervisor.stop()
  })

  it('manager probe failure reports the failure stage', async () => {
    const manager: ManagerPort = {
      register: () => () => undefined,
      probe: async () => failureProbe('handshake rejected', 50),
    }
    const supervisor = new Supervisor({ modules: baseModules(1), manager, pollMs: 50 })
    supervisor.attachManager(manager)
    await supervisor.start()
    await new Promise(r => setTimeout(r, 50))
    const result = await supervisor.probe('module-0')
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.stage, 'connect')
    assert.strictEqual(result.message, 'handshake rejected')
    supervisor.stop()
  })

  it('manager status failure moves an enabled gated module to error', async () => {
    const manager: ManagerPort = { register: () => () => undefined }
    const gate = { running: async () => new Set(['revit.exe']) }
    const supervisor = new Supervisor({
      modules: [gatedModule('rvt-fail')],
      pollMs: 20,
      manager,
      appGate: gate,
    })
    supervisor.attachManager(manager)
    await supervisor.start()
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(supervisor.snapshot()[0]!.state, 'starting')
    supervisor.handleStatus('rvt-fail', { state: 'failed', reason: 'gave-up', lastError: 'no server' })
    await new Promise(r => setTimeout(r, 50))
    const status = supervisor.snapshot()[0]!
    assert.strictEqual(status.state, 'error')
    assert.ok(status.detail.includes('no server'))
    supervisor.stop()
  })

  it('supervisor stop releases registrations and stops polling', async () => {
    const manager: ManagerPort = { register: () => () => undefined }
    const gate = { running: async () => new Set(['revit.exe']) }
    const supervisor = new Supervisor({
      modules: [gatedModule('rvt-stop')],
      pollMs: 20,
      manager,
      appGate: gate,
    })
    supervisor.attachManager(manager)
    await supervisor.start()
    await new Promise(r => setTimeout(r, 50))
    supervisor.stop()
    assert.strictEqual(supervisor.polling(), false)
    const statuses = supervisor.snapshot()
    assert.strictEqual(statuses[0]!.state, 'disabled')
    assert.strictEqual(statuses[0]!.detail, 'The hub stopped.')
  })

  it('connecting is starting, not error', async () => {
    const manager: ManagerPort = { register: () => () => undefined }
    const supervisor = new Supervisor({ modules: baseModules(1), manager, pollMs: 50 })
    supervisor.attachManager(manager)
    await supervisor.start()
    supervisor.handleStatus('module-0', { state: 'connecting', attempt: 0 })
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(supervisor.snapshot()[0]!.state, 'starting')
    supervisor.stop()
  })
})

