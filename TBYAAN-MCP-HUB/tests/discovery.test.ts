/**
 * Unit tests for {@link discoverModules}: confidence assignment and evidence.
 * @module @PINNACLE/mcp-hub/tests/discovery
 */

import assert from 'node:assert'
import { describe, it } from 'node:test'
import { createSystemAppGate } from '../src/app-gate.ts'
import { discoverModules } from '../src/discovery.ts'
import type { DiscoverableModule } from '../src/types.ts'

function moduleOverrides(partial: Partial<DiscoverableModule>): DiscoverableModule {
  return {
    id: 'test-module',
    title: 'Test Module',
    requiresApp: true,
    ...partial,
  }
}

describe('discoverModules', () => {
  it('reports high when server and app are both found', async () => {
    const mod = moduleOverrides({
      discovery: { serverPaths: [process.execPath], appPaths: [process.execPath] },
    })
    const results = await discoverModules([mod], createSystemAppGate())
    assert.strictEqual(results[0]!.confidence, 'high')
    assert.strictEqual(results[0]!.command, process.execPath)
    assert.strictEqual(results[0]!.appInstalled, true)
  })

  it('reports high for standalone modules with a server', async () => {
    const mod = moduleOverrides({ requiresApp: false, discovery: { serverPaths: [process.execPath] } })
    const results = await discoverModules([mod], createSystemAppGate())
    assert.strictEqual(results[0]!.confidence, 'high')
  })

  it('reports medium when only the server is found', async () => {
    const mod = moduleOverrides({
      requiresApp: true,
      discovery: { serverPaths: [process.execPath], appPaths: ['/nonexistent/nope.exe'] },
    })
    const results = await discoverModules([mod], createSystemAppGate())
    assert.strictEqual(results[0]!.confidence, 'medium')
  })

  it('reports medium when only the app is found', async () => {
    const mod = moduleOverrides({
      requiresApp: true,
      discovery: { serverPaths: ['/nonexistent/nope.exe'], appPaths: [process.execPath] },
    })
    const results = await discoverModules([mod], createSystemAppGate())
    assert.strictEqual(results[0]!.confidence, 'medium')
  })

  it('reports low when nothing is found', async () => {
    const mod = moduleOverrides({
      requiresApp: true,
      discovery: { serverPaths: ['/nonexistent/a.exe'], appPaths: ['/nonexistent/b.exe'] },
    })
    const results = await discoverModules([mod], createSystemAppGate())
    assert.strictEqual(results[0]!.confidence, 'low')
  })

  it('reports none when unsupported', async () => {
    const mod = moduleOverrides({ discovery: { unsupported: true } })
    const results = await discoverModules([mod], createSystemAppGate())
    assert.strictEqual(results[0]!.confidence, 'none')
    assert.strictEqual(results[0]!.unsupported, true)
  })

  it('reports low for standalone modules without a server', async () => {
    const mod = moduleOverrides({ requiresApp: false, discovery: { serverPaths: [] } })
    const results = await discoverModules([mod], createSystemAppGate())
    assert.strictEqual(results[0]!.confidence, 'low')
  })

  it('checks app running through the gate', async () => {
    const runningGate = { running: async () => new Set(['revit.exe']) }
    const mod = moduleOverrides({
      requiresApp: true,
      app: { processNames: ['revit.exe'] },
      discovery: { serverPaths: [process.execPath], appPaths: [process.execPath] },
    })
    const results = await discoverModules([mod], runningGate)
    assert.strictEqual(results[0]!.appRunning, true)
    assert.strictEqual(results[0]!.confidence, 'high')
  })
})

