import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadPacks } from '../src/registry.ts'

test('an empty pack list loads nothing', async () => {
  assert.deepEqual(await loadPacks([]), [])
})

test('a duplicated pack name is rejected before any import', async () => {
  await assert.rejects(
    loadPacks(['@PINNACLE/pack-aec', '@PINNACLE/pack-aec']),
    /pack "@PINNACLE\/pack-aec" is listed twice in config\.packs/,
  )
})

test('an unresolvable pack names the package and the install command', async () => {
  await assert.rejects(
    loadPacks(['@PINNACLE/pack-does-not-exist']),
    /cannot load pack "@PINNACLE\/pack-does-not-exist"[\s\S]*dsh plugin add @PINNACLE\/pack-does-not-exist/,
  )
})

