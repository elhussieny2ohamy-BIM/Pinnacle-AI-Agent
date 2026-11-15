/**
 * Unit tests for snapshot execution against fake MCP tools.
 * @module @PINNACLE/mcp-hub/tests/backup-runner
 */

import assert from 'node:assert'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { findDocumentPath, probeToolCapability, takeSnapshot } from '../src/backup-runner.ts'
import type { CallableTool, ToolCatalog } from '../src/backup-runner.ts'
import type { HubBackupConfig, PackModule } from '../src/types.ts'

let dir = ''

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'PINNACLE-runner-'))
})

after(() => {
  rmSync(dir, { recursive: true, force: true })
})

const SETTINGS: HubBackupConfig = {
  failure: 'block', dedupeMs: 0, keep: 3, minFreeMb: 0, timeoutMs: 200, files: {},
}

const SAVE_MODULE: PackModule = {
  id: 'rhino', title: 'Rhino', toolPrefix: 'rhino', requiresApp: false,
  backup: { supported: true, tool: 'rhino_save' },
}

function catalog(tools: CallableTool[]): ToolCatalog {
  const map = new Map(tools.map(tool => [tool.name, tool]))
  return { executable: name => map.get(name), definitions: () => tools }
}

describe('probeToolCapability', () => {
  it('finds the save tool and its path argument from the schema', () => {
    const save: CallableTool = {
      name: 'mcp__rhino__rhino_save',
      parameters: { type: 'object', properties: { file_path: { type: 'string' } } },
      execute: async () => ({}),
    }
    const probe = probeToolCapability(catalog([save]), SAVE_MODULE, { kind: 'tool', tool: 'rhino_save' })
    assert.strictEqual(probe.saveTool, save)
    assert.strictEqual(probe.pathParam, 'file_path')
    assert.strictEqual(probe.docPathTool, null)
  })

  it('honors the pack-declared path argument over the schema', () => {
    const save: CallableTool = {
      name: 'mcp__rhino__rhino_save',
      parameters: { properties: { other: { type: 'string' } } },
      execute: async () => ({}),
    }
    const probe = probeToolCapability(catalog([save]), SAVE_MODULE, {
      kind: 'tool', tool: 'rhino_save', pathArg: 'other',
    })
    assert.strictEqual(probe.pathParam, 'other')
  })

  it('returns an empty probe when the registry is absent', () => {
    const probe = probeToolCapability(undefined, SAVE_MODULE, { kind: 'tool', tool: 'rhino_save' })
    assert.strictEqual(probe.saveTool, null)
    assert.strictEqual(probe.pathParam, null)
    assert.strictEqual(probe.docPathTool, null)
  })
})

describe('findDocumentPath', () => {
  it('finds a document path inside nested MCP content', () => {
    const value = { content: [{ type: 'text', text: 'C:\\work\\model.3dm' }] }
    assert.strictEqual(findDocumentPath(value), 'C:\\work\\model.3dm')
  })

  it('returns null when no path is present', () => {
    assert.strictEqual(findDocumentPath({ content: [{ type: 'text', text: 'ok' }] }), null)
  })
})

describe('takeSnapshot with a save tool', () => {
  it('passes the destination when the tool accepts a path', async () => {
    const destination = join(dir, 'path-mode.3dm')
    const save: CallableTool = {
      name: 'mcp__rhino__rhino_save',
      parameters: { properties: { path: { type: 'string' } } },
      execute: async args => {
        writeFileSync((args as { path: string }).path, 'snapshot-bytes')
        return { content: [] }
      },
    }
    const outcome = await takeSnapshot(SAVE_MODULE, { kind: 'tool', tool: 'rhino_save' }, catalog([save]), SETTINGS, destination, false)
    assert.strictEqual(outcome.status, 'created')
    assert.strictEqual(outcome.bytes, 'snapshot-bytes'.length)
    assert.strictEqual(outcome.path, destination)
  })

  it('saves in place then copies the reported document path', async () => {
    const source = join(dir, 'source.3dm')
    writeFileSync(source, 'document')
    const destination = join(dir, 'copy-mode.3dm')
    const save: CallableTool = { name: 'mcp__rhino__rhino_save', execute: async () => ({ content: [] }) }
    const info: CallableTool = {
      name: 'mcp__rhino__rhino_document_info',
      execute: async () => ({ content: [{ type: 'text', text: source }] }),
    }
    const outcome = await takeSnapshot(
      SAVE_MODULE,
      { kind: 'tool', tool: 'rhino_save', docPathTool: 'rhino_document_info' },
      catalog([save, info]),
      SETTINGS,
      destination,
      false,
    )
    assert.strictEqual(outcome.status, 'created')
    assert.strictEqual(outcome.bytes, 'document'.length)
  })

  it('reports unsupported when the tool is not registered', async () => {
    const outcome = await takeSnapshot(SAVE_MODULE, { kind: 'tool', tool: 'rhino_save' }, catalog([]), SETTINGS, join(dir, 'x.3dm'), false)
    assert.strictEqual(outcome.status, 'unsupported')
  })

  it('reports unsupported when neither a path nor a document tool exists', async () => {
    const save: CallableTool = { name: 'mcp__rhino__rhino_save', execute: async () => ({ content: [] }) }
    const outcome = await takeSnapshot(SAVE_MODULE, { kind: 'tool', tool: 'rhino_save' }, catalog([save]), SETTINGS, join(dir, 'y.3dm'), false)
    assert.strictEqual(outcome.status, 'unsupported')
    assert.ok(outcome.reason?.includes('document-path'))
  })

  it('fails when the save tool writes nothing', async () => {
    const save: CallableTool = {
      name: 'mcp__rhino__rhino_save',
      parameters: { properties: { path: { type: 'string' } } },
      execute: async () => ({ content: [] }),
    }
    const outcome = await takeSnapshot(SAVE_MODULE, { kind: 'tool', tool: 'rhino_save' }, catalog([save]), SETTINGS, join(dir, 'z.3dm'), false)
    assert.strictEqual(outcome.status, 'failed')
    assert.ok(outcome.reason?.includes('not written'))
  })

  it('turns a throwing tool into a failed outcome', async () => {
    const save: CallableTool = {
      name: 'mcp__rhino__rhino_save',
      parameters: { properties: { path: { type: 'string' } } },
      execute: async () => { throw new Error('server exploded') },
    }
    const outcome = await takeSnapshot(SAVE_MODULE, { kind: 'tool', tool: 'rhino_save' }, catalog([save]), SETTINGS, join(dir, 'f.3dm'), false)
    assert.strictEqual(outcome.status, 'failed')
    assert.ok(outcome.reason?.includes('server exploded'))
  })

  it('times out a tool that ignores its signal', async () => {
    const save: CallableTool = {
      name: 'mcp__rhino__rhino_save',
      parameters: { properties: { path: { type: 'string' } } },
      execute: () => new Promise(() => {}),
    }
    const outcome = await takeSnapshot(
      SAVE_MODULE, { kind: 'tool', tool: 'rhino_save' }, catalog([save]),
      { ...SETTINGS, timeoutMs: 10 }, join(dir, 't.3dm'), false,
    )
    assert.strictEqual(outcome.status, 'failed')
    assert.ok(/timeout|abort/i.test(outcome.reason ?? ''))
  })
})

describe('takeSnapshot from a configured file', () => {
  it('copies a closed document', async () => {
    const source = join(dir, 'closed.rvt')
    writeFileSync(source, 'revit-bytes')
    const destination = join(dir, 'closed-copy.rvt')
    const outcome = await takeSnapshot(
      { id: 'rvt', title: 'Revit', toolPrefix: 'rvt', requiresApp: true, backup: { supported: false } },
      { kind: 'file', source },
      undefined,
      SETTINGS,
      destination,
      false,
    )
    assert.strictEqual(outcome.status, 'created')
    assert.strictEqual(outcome.bytes, 'revit-bytes'.length)
  })

  it('skips while the host application is running', async () => {
    const outcome = await takeSnapshot(
      { id: 'rvt', title: 'Revit', toolPrefix: 'rvt', requiresApp: true, backup: { supported: false } },
      { kind: 'file', source: join(dir, 'closed.rvt') },
      undefined,
      SETTINGS,
      join(dir, 'skip.rvt'),
      true,
    )
    assert.strictEqual(outcome.status, 'skipped')
    assert.ok(outcome.reason?.includes('running'))
  })

  it('fails when the configured document is missing', async () => {
    const outcome = await takeSnapshot(
      { id: 'rvt', title: 'Revit', toolPrefix: 'rvt', requiresApp: true, backup: { supported: false } },
      { kind: 'file', source: join(dir, 'absent.rvt') },
      undefined,
      SETTINGS,
      join(dir, 'absent.rvt.bak'),
      false,
    )
    assert.strictEqual(outcome.status, 'failed')
  })
})

