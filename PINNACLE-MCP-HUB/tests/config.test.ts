import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readHubConfig } from '../src/config.ts'

test('an empty row config yields the documented defaults', () => {
  const config = readHubConfig(undefined)
  assert.deepEqual(config.packs, [])
  assert.equal(config.discovery.applyMode, 'confirm')
  assert.equal(config.defaults.profile, 'coordination')
  assert.equal(config.defaults.writeMode, 'deny')
  assert.equal(config.defaults.maxVisibleTools, 120)
})

test('a partial defaults section keeps the other defaults', () => {
  const config = readHubConfig({ defaults: { writeMode: 'allow' } })
  assert.equal(config.defaults.writeMode, 'allow')
  assert.equal(config.defaults.profile, 'coordination')
})

test('an unknown policy value names the field and the accepted values', () => {
  assert.throws(
    () => readHubConfig({ defaults: { writeMode: 'nope' } }),
    /config\.defaults\.writeMode must be one of deny \| confirm \| allow, got "nope"/,
  )
})

test('packs must be a list of non-empty package names', () => {
  assert.throws(() => readHubConfig({ packs: 'pack-aec' }), /config\.packs must be a list/)
  assert.throws(() => readHubConfig({ packs: [''] }), /config\.packs\[0\] must be a non-empty string/)
})

test('the visible-tool bound must be a positive integer', () => {
  assert.throws(() => readHubConfig({ defaults: { maxVisibleTools: 0 } }), /must be a positive integer/)
  assert.throws(() => readHubConfig({ defaults: { maxVisibleTools: 1.5 } }), /must be a positive integer/)
})

test('a non-mapping config is rejected instead of ignored', () => {
  assert.throws(() => readHubConfig([]), /config must be a mapping/)
})

test('backup defaults fail closed with bounded retention', () => {
  const config = readHubConfig(undefined)
  assert.equal(config.backup.failure, 'block')
  assert.equal(config.backup.dedupeMs, 120_000)
  assert.equal(config.backup.keep, 10)
  assert.equal(config.backup.minFreeMb, 2048)
  assert.equal(config.backup.timeoutMs, 20_000)
  assert.deepEqual(config.backup.files, {})
})

test('backup values are validated by name', () => {
  assert.throws(() => readHubConfig({ backup: { failure: 'maybe' } }), /config\.backup\.failure must be one of block \| warn/)
  assert.throws(() => readHubConfig({ backup: { keep: 0 } }), /config\.backup\.keep must be a positive integer/)
  assert.throws(() => readHubConfig({ backup: { dedupeMs: -1 } }), /config\.backup\.dedupeMs must be a non-negative integer/)
  assert.throws(() => readHubConfig({ backup: { minFreeMb: 1.5 } }), /config\.backup\.minFreeMb must be a non-negative integer/)
  assert.throws(() => readHubConfig({ backup: { timeoutMs: 0 } }), /config\.backup\.timeoutMs must be a positive integer/)
})

test('backup file paths must be absolute', () => {
  assert.throws(
    () => readHubConfig({ backup: { files: { rvt: 'models\\a.rvt' } } }),
    /config\.backup\.files\.rvt must be an absolute path/,
  )
  const absolute = process.platform === 'win32' ? 'C:\\models\\a.rvt' : '/models/a.rvt'
  assert.equal(readHubConfig({ backup: { files: { rvt: absolute } } }).backup.files.rvt, absolute)
})
