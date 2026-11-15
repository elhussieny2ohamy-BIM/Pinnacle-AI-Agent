/**
 * Unit tests for the backup policy and snapshot store.
 * @module @PINNACLE/mcp-hub/tests/backup
 */

import assert from 'node:assert'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  freeMegabytes, listSnapshots, pruneSnapshots, resolveBackup, serializeByKey, snapshotPath,
} from '../src/backup.ts'
import type { HubBackupConfig, PackModule } from '../src/types.ts'

let root = ''

before(() => {
  root = mkdtempSync(join(tmpdir(), 'PINNACLE-backup-'))
  process.env.PINNACLE_BACKUP_DIR = root
})

after(() => {
  delete process.env.PINNACLE_BACKUP_DIR
  rmSync(root, { recursive: true, force: true })
})

const SETTINGS: HubBackupConfig = {
  failure: 'block',
  dedupeMs: 120_000,
  keep: 3,
  minFreeMb: 0,
  timeoutMs: 1000,
  files: {},
}

function moduleDef(overrides: Partial<PackModule> = {}): PackModule {
  return {
    id: 'test',
    title: 'Test',
    toolPrefix: 'test',
    requiresApp: true,
    backup: { supported: false },
    ...overrides,
  }
}

describe('resolveBackup', () => {
  it('returns none when no tool and no configured file exists', () => {
    const decision = resolveBackup(moduleDef(), SETTINGS)
    assert.strictEqual(decision.kind, 'none')
  })

  it('returns unsupported when support is declared without a tool', () => {
    const decision = resolveBackup(moduleDef({ backup: { supported: true } }), SETTINGS)
    assert.strictEqual(decision.kind, 'unsupported')
  })

  it('returns the declared tool with its hints', () => {
    const decision = resolveBackup(moduleDef({
      backup: { supported: true, tool: 'rhino_save', pathArg: 'path', docPathTool: 'rhino_document_info' },
    }), SETTINGS)
    assert.strictEqual(decision.kind, 'tool')
    if (decision.kind !== 'tool') return
    assert.strictEqual(decision.tool, 'rhino_save')
    assert.strictEqual(decision.pathArg, 'path')
    assert.strictEqual(decision.docPathTool, 'rhino_document_info')
  })

  it('uses a configured file when the module declares no tool', () => {
    const decision = resolveBackup(moduleDef({ id: 'rvt' }), { ...SETTINGS, files: { rvt: 'C:\\models\\a.rvt' } })
    assert.strictEqual(decision.kind, 'file')
    if (decision.kind !== 'file') return
    assert.strictEqual(decision.source, 'C:\\models\\a.rvt')
  })
})

describe('snapshotPath', () => {
  it('creates the module directory and a unique path per call', () => {
    const module = moduleDef({ id: 'rhino', backup: { supported: true, tool: 'rhino_save' } })
    const now = new Date('2026-11-10T12:00:00.000Z')
    const first = snapshotPath(module, now, root)
    writeFileSync(first, 'snapshot')
    const second = snapshotPath(module, now, root)
    assert.notStrictEqual(first, second)
    assert.ok(first.endsWith('.3dm'))
    assert.ok(second.endsWith('-1.3dm'))
  })

  it('uses the document extension for known modules', () => {
    assert.ok(snapshotPath(moduleDef({ id: 'rvt' }), new Date(), root).endsWith('.rvt'))
    assert.ok(snapshotPath(moduleDef({ id: 'autocad' }), new Date(), root).endsWith('.dwg'))
  })
})

describe('pruneSnapshots / listSnapshots', () => {
  it('keeps the newest N snapshots and lists what remains', () => {
    const module = moduleDef({ id: 'prune' })
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(snapshotPath(module, new Date(Date.now() + index * 1000), root), `v${index}`)
    }
    assert.strictEqual(listSnapshots(root).filter(s => s.module === 'prune').length, 5)
    const removed = pruneSnapshots('prune', 2, root)
    assert.strictEqual(removed, 3)
    assert.strictEqual(listSnapshots(root).filter(s => s.module === 'prune').length, 2)
  })

  it('returns zero when the module has no directory', () => {
    assert.strictEqual(pruneSnapshots('absent', 2, root), 0)
  })
})

describe('freeMegabytes', () => {
  it('reports a positive number for an existing volume', () => {
    assert.ok(freeMegabytes(root) > 0)
  })
})

describe('serializeByKey', () => {
  it('runs same-key tasks in order and different keys independently', async () => {
    const serialize = serializeByKey()
    const order: string[] = []
    const slow = serialize('a', async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
      order.push('a1')
    })
    const fast = serialize('a', async () => {
      order.push('a2')
    })
    const other = serialize('b', async () => {
      order.push('b1')
    })
    await Promise.all([slow, fast, other])
    assert.ok(order.indexOf('a1') < order.indexOf('a2'))
    assert.ok(order.includes('b1'))
  })
})

