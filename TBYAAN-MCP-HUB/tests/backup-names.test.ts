/**
 * Unit tests for MCP tool-name parsing and write classification.
 * @module @PINNACLE/mcp-hub/tests/backup-names
 */

import assert from 'node:assert'
import { describe, it } from 'node:test'
import { classifyTool, isGoverned, parseMcpToolName } from '../src/backup-names.ts'
import type { PackModule } from '../src/types.ts'

const MODULES = new Map([
  ['rvt', { id: 'rvt', toolPrefix: 'rvt' }],
  ['rhino', { id: 'rhino', toolPrefix: 'rhino' }],
  ['navis', { id: 'navis', toolPrefix: 'navisworks' }],
])

function moduleDef(overrides: Partial<PackModule> = {}): PackModule {
  return {
    id: 'rhino',
    title: 'Rhino',
    toolPrefix: 'rhino',
    requiresApp: false,
    backup: { supported: true, tool: 'rhino_save' },
    ...overrides,
  }
}

describe('parseMcpToolName', () => {
  it('parses the namespaced form used by the MCP bridge', () => {
    assert.deepStrictEqual(parseMcpToolName('mcp__rhino__rhino_save', MODULES), { moduleId: 'rhino', raw: 'rhino_save' })
    assert.deepStrictEqual(parseMcpToolName('mcp__rvt__get_elements', MODULES), { moduleId: 'rvt', raw: 'get_elements' })
  })

  it('rejects namespaces for unknown modules', () => {
    assert.strictEqual(parseMcpToolName('mcp__acad__save', MODULES), undefined)
  })

  it('accepts a legacy prefix and prefers the longest prefix', () => {
    const modules = new Map([
      ['navis', { id: 'navis', toolPrefix: 'navis' }],
      ['navisworks', { id: 'navisworks', toolPrefix: 'navisworks' }],
    ])
    assert.deepStrictEqual(parseMcpToolName('navisworks_open', modules), { moduleId: 'navisworks', raw: 'open' })
    assert.deepStrictEqual(parseMcpToolName('navis_scan', modules), { moduleId: 'navis', raw: 'scan' })
  })

  it('returns undefined for unrelated tools', () => {
    assert.strictEqual(parseMcpToolName('aec_control', MODULES), undefined)
    assert.strictEqual(parseMcpToolName('mcp__rhino__', MODULES), undefined)
  })
})

describe('classifyTool', () => {
  it('classifies the declared backup tool as backup', () => {
    assert.strictEqual(classifyTool(moduleDef(), 'rhino_save'), 'backup')
  })

  it('honors explicit reads and writes lists', () => {
    const module = moduleDef({ reads: ['custom_probe'], writes: ['custom_mutate'] })
    assert.strictEqual(classifyTool(module, 'custom_probe'), 'read')
    assert.strictEqual(classifyTool(module, 'custom_mutate'), 'write')
  })

  it('detects reads by token', () => {
    for (const name of ['get_document_info', 'list_layers', 'rhino_document_info', 'ping']) {
      assert.strictEqual(classifyTool(moduleDef(), name), 'read', name)
    }
  })

  it('detects writes by token', () => {
    for (const name of ['drawing_save_as', 'add_wall', 'update_parameter', 'create_sheet', 'set_parameter', 'delete_element']) {
      assert.strictEqual(classifyTool(moduleDef(), name), 'write', name)
    }
  })

  it('prefers write when both kinds of token appear', () => {
    assert.strictEqual(classifyTool(moduleDef(), 'get_and_update_parameter'), 'write')
  })

  it('treats unknown names as writes so mutations cannot bypass policy', () => {
    assert.strictEqual(classifyTool(moduleDef({ backup: { supported: false } }), 'frobnicate_widget'), 'unknown')
    assert.strictEqual(isGoverned('unknown'), true)
    assert.strictEqual(isGoverned('read'), false)
    assert.strictEqual(isGoverned('backup'), true)
  })
})

