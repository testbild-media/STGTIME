import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigStore, mergeConfig } from '../src/core/config-store.mjs'

test('deep configuration updates preserve sibling values', () => {
  assert.deepEqual(mergeConfig({ a: { b: 1, c: 2 } }, { a: { b: 3 } }), { a: { b: 3, c: 2 } })
})

test('first load creates secrets and persists atomically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stgtime-'))
  try {
    const store = new ConfigStore({ defaultsPath: new URL('../config/default.json', import.meta.url), dataPath: join(directory, 'config.json') })
    const config = await store.load()
    assert.match(config.security.passwordHash, /^scrypt\$/); assert.ok(config.security.apiToken.length >= 24)
    const persisted = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'))
    assert.equal(persisted.security.apiToken, config.security.apiToken)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('message visibility and content survive a service restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stgtime-reboot-'))
  const dataPath = join(directory, 'config.json')
  try {
    const first = new ConfigStore({ defaultsPath: new URL('../config/default.json', import.meta.url), dataPath })
    await first.load(); await first.update({ message: { visible: true, text: 'READY' } })
    const restarted = new ConfigStore({ defaultsPath: new URL('../config/default.json', import.meta.url), dataPath })
    const config = await restarted.load()
    assert.equal(config.message.visible, true); assert.equal(config.message.text, 'READY')
    const toggled = await restarted.update({ message: { visible: false } })
    assert.equal(toggled.message.visible, false); assert.equal(toggled.message.text, 'READY')
    const shownAgain = await restarted.update({ message: { visible: true } })
    assert.equal(shownAgain.message.visible, true); assert.equal(shownAgain.message.text, 'READY')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('legacy display timing is migrated to the stable HUB75 profile', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stgtime-migrate-'))
  const dataPath = join(directory, 'config.json')
  try {
    await writeFile(dataPath, JSON.stringify({ display: { brightness: 42, limitRefreshRateHz: 400 }, presets: [{ id: 'short', name: 'Short', durationMs: 120000 }] }))
    const store = new ConfigStore({ defaultsPath: new URL('../config/default.json', import.meta.url), dataPath })
    const config = await store.load()
    assert.equal(config.schemaVersion, 3)
    assert.equal(config.display.brightness, 42)
    assert.equal(config.display.pwmBits, 8)
    assert.equal(config.display.limitRefreshRateHz, 200)
    assert.deepEqual(config.presets[0].thresholdsMs, { warning: 20000, critical: 10000 })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
