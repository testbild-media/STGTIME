import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigStore } from '../src/core/config-store.mjs'
import { TimerEngine } from '../src/core/timer.mjs'
import { AuthManager } from '../src/auth.mjs'
import { FrameBuffer } from '../src/display/framebuffer.mjs'
import { createHandler } from '../src/application.mjs'

test('authenticated API controls timer and never exposes secrets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stgtime-api-'))
  const store = new ConfigStore({ defaultsPath: new URL('../config/default.json', import.meta.url), dataPath: join(directory, 'config.json') })
  await store.load(); await store.update({ security: { webAuthMode: 'always' } })
  const timer = new TimerEngine(store.get().timer)
  const auth = new AuthManager({ getSecurity: () => store.get().security })
  let settings = store.get()
  let appliedTimeZone = null
  let updateQueued = false
  const context = {
    timer, store, auth,
    network: { addresses: () => [], ethernetStatus: async () => ({ interface: 'eth0', address: '192.0.2.10/24', gateway: '192.0.2.1', dns: '192.0.2.53' }), apply: async () => ({ applied: false }) },
    system: { setTimeZone: async timeZone => { appliedTimeZone = timeZone; return { applied: true } } },
    updates: { check: async () => ({ installedVersion: '1.0.0', available: true }), status: async () => ({ installedVersion: '1.0.0', updater: { state: 'idle' } }), installLatest: async () => { updateQueued = true; return { accepted: true, version: '1.1.0' } } },
    version: '1.0.0',
    getFrame: () => new FrameBuffer(), webRoot: directory, logoPath: '',
    state: () => ({ timer: timer.status(), display: {}, message: settings.message, video: settings.video, system: { addresses: [] } }),
    settingsChanged: next => { settings = next }
  }
  const server = createServer(createHandler(context))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal((await fetch(`${base}/api/v1/state`)).status, 401)
    const login = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'stagetimer' }) })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const response = await fetch(`${base}/api/v1/timer`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ durationMs: 42_000 }) })
    assert.equal(response.status, 200); assert.equal((await response.json()).timer.valueMs, 42_000)
    const config = await (await fetch(`${base}/api/v1/config`, { headers: { cookie } })).json()
    assert.equal(config.security.apiToken, undefined); assert.equal(config.security.passwordHash, undefined)
    const networkStatus = await (await fetch(`${base}/api/v1/network`, { headers: { cookie } })).json()
    assert.deepEqual(networkStatus.ethernet, { interface: 'eth0', address: '192.0.2.10/24', gateway: '192.0.2.1', dns: '192.0.2.53' })

    const timeZone = await fetch(`${base}/api/v1/config`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ display: { timeZone: 'Asia/Tokyo' } }) })
    assert.equal(timeZone.status, 200); assert.equal((await timeZone.json()).display.timeZone, 'Asia/Tokyo')
    assert.equal(appliedTimeZone, 'Asia/Tokyo')
    const invalidTimeZone = await fetch(`${base}/api/v1/config`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ display: { timeZone: 'Not/AZone' } }) })
    assert.equal(invalidTimeZone.status, 400); assert.deepEqual(await invalidTimeZone.json(), { error: 'invalid_time_zone' })
    assert.equal(appliedTimeZone, 'Asia/Tokyo')

    const messageHeaders = { cookie, 'content-type': 'application/json' }
    await fetch(`${base}/api/v1/message`, { method: 'PUT', headers: messageHeaders, body: JSON.stringify({ visible: true, text: '  READY  ', color: '#ffffff' }) })
    const hidden = await (await fetch(`${base}/api/v1/message`, { method: 'PUT', headers: messageHeaders, body: JSON.stringify({ visible: false }) })).json()
    assert.deepEqual(hidden, { visible: false, text: 'READY', color: '#ffffff' })
    const changed = await (await fetch(`${base}/api/v1/message`, { method: 'PUT', headers: messageHeaders, body: JSON.stringify({ text: 'GO', color: '#00ff00' }) })).json()
    assert.deepEqual(changed, { visible: false, text: 'GO', color: '#00ff00' })

    const presetUpdate = await fetch(`${base}/api/v1/presets`, { method: 'PUT', headers: messageHeaders, body: JSON.stringify({ presets: [{ id: 'two', name: 'Two minutes', durationMs: 120000, thresholdsMs: { warning: 20000, critical: 10000 } }] }) })
    assert.equal(presetUpdate.status, 200)
    assert.deepEqual((await presetUpdate.json()).presets[0].thresholdsMs, { warning: 20000, critical: 10000 })
    const loadedPreset = await fetch(`${base}/api/v1/presets/two`, { method: 'POST', headers: messageHeaders })
    assert.equal(loadedPreset.status, 200)
    assert.equal((await loadedPreset.json()).timer.valueMs, 120000)
    const afterPreset = await (await fetch(`${base}/api/v1/config`, { headers: { cookie } })).json()
    assert.equal(afterPreset.timer.durationMs, 120000)
    assert.deepEqual(afterPreset.timer.thresholdsMs, { warning: 20000, critical: 10000 })

    const invalidPreset = await fetch(`${base}/api/v1/presets`, { method: 'PUT', headers: messageHeaders, body: JSON.stringify({ presets: [{ name: 'Broken', durationMs: 60000, thresholdsMs: { warning: 10000, critical: 20000 } }] }) })
    assert.equal(invalidPreset.status, 400)
    assert.deepEqual(await invalidPreset.json(), { error: 'invalid_preset_thresholds' })

    const passwordWithoutCurrent = await fetch(`${base}/api/v1/security/password`, { method: 'PUT', headers: messageHeaders, body: JSON.stringify({ newPassword: 'attacker-password' }) })
    assert.equal(passwordWithoutCurrent.status, 403)
    assert.deepEqual(await passwordWithoutCurrent.json(), { error: 'current_password_is_incorrect' })
    const updateWithUnapprovedPassword = await fetch(`${base}/api/v1/update/install`, { method: 'POST', headers: messageHeaders, body: JSON.stringify({ password: 'attacker-password' }) })
    assert.equal(updateWithUnapprovedPassword.status, 403)
    assert.equal(updateQueued, false)

    const rejectedUpdate = await fetch(`${base}/api/v1/update/install`, { method: 'POST', headers: messageHeaders, body: JSON.stringify({ password: 'wrong' }) })
    assert.equal(rejectedUpdate.status, 403)
    assert.equal(updateQueued, false)
    const acceptedUpdate = await fetch(`${base}/api/v1/update/install`, { method: 'POST', headers: messageHeaders, body: JSON.stringify({ password: 'stagetimer' }) })
    assert.equal(acceptedUpdate.status, 202)
    assert.equal(updateQueued, true)
    assert.deepEqual(await acceptedUpdate.json(), { accepted: true, version: '1.1.0' })

    const changedPassword = await fetch(`${base}/api/v1/security/password`, { method: 'PUT', headers: messageHeaders, body: JSON.stringify({ currentPassword: 'stagetimer', newPassword: 'replacement-password' }) })
    assert.equal(changedPassword.status, 200)
    assert.deepEqual(await changedPassword.json(), { changed: true, reauthenticationRequired: true })
    assert.equal((await fetch(`${base}/api/v1/state`, { headers: { cookie } })).status, 401)
    assert.equal((await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'stagetimer' }) })).status, 401)
    assert.equal((await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'replacement-password' }) })).status, 200)
  } finally {
    await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true })
  }
})
