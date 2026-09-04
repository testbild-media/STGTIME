import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareVersions, releaseStatus, UpdateService } from '../src/update/service.mjs'

test('semantic release comparison handles stable and prerelease versions', () => {
  assert.equal(compareVersions('1.0.0-alpha.1', '1.0.0'), -1)
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1)
  assert.equal(compareVersions('1.0.0-1', '1.0.0-alpha'), -1)
  assert.equal(compareVersions('1.0.0+build.1', '1.0.0+build.2'), 0)
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1)
  assert.equal(compareVersions('v2.0.0', '2.0.0'), 0)
  assert.equal(releaseStatus('0.9.0-alpha', '0.9.1-alpha'), 'update-available')
  assert.equal(releaseStatus('0.9.0-alpha', '0.9.0-alpha'), 'up-to-date')
  assert.equal(releaseStatus('0.9.1-alpha', '0.9.0-alpha'), 'installed-newer')
  assert.equal(releaseStatus('0.9.0-alpha', '0.9.5-beta'), 'update-available')
})

test('GitHub release check includes prereleases and queues the newest semantic version', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'stgtime-update-'))
  let triggered = false
  const release = {
    tag_name: 'v1.1.0-beta', name: 'STGTIME 1.1.0 beta', body: 'Safer updates', html_url: 'https://github.com/testbild-media/STGTIME/releases/tag/v1.1.0-beta', published_at: '2026-09-04T00:00:00Z', prerelease: true,
    assets: [{ name: 'stgtime-rpi4-arm64-1.1.0-beta.tar.gz', size: 1234, browser_download_url: 'https://github.com/testbild-media/STGTIME/releases/download/v1.1.0-beta/stgtime-rpi4-arm64-1.1.0-beta.tar.gz', digest: `sha256:${'a'.repeat(64)}` }]
  }
  const releases = [
    { tag_name: 'v1.0.0', draft: false, prerelease: false, assets: [] },
    { tag_name: 'v9.0.0', draft: true, prerelease: false, assets: [] },
    release
  ]
  try {
    let requestedUrl = ''
    const updates = new UpdateService({ version: '1.0.0', stateDir, fetchImpl: async url => { requestedUrl = url; return new Response(JSON.stringify(releases), { status: 200 }) }, trigger: async () => { triggered = true } })
    const checked = await updates.check()
    assert.equal(checked.available, true)
    assert.equal(checked.latestVersion, '1.1.0-beta')
    assert.equal(checked.prerelease, true)
    assert.equal(checked.asset.sha256, 'a'.repeat(64))
    assert.match(requestedUrl, /\/releases\?per_page=100$/)
    assert.equal((await updates.status()).latestVersion, '1.1.0-beta')
    await updates.installLatest()
    assert.equal(triggered, true)
    const request = JSON.parse(await readFile(join(stateDir, 'request.json'), 'utf8'))
    assert.deepEqual(request, { source: 'github', version: '1.1.0-beta', url: release.assets[0].browser_download_url, sha256: 'a'.repeat(64) })
  } finally { await rm(stateDir, { recursive: true, force: true }) }
})

test('GitHub release check ignores drafts and invalid version tags', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'stgtime-no-release-'))
  try {
    const releases = [
      { tag_name: 'nightly', draft: false, prerelease: true },
      { tag_name: 'v9.0.0', draft: true, prerelease: false }
    ]
    const updates = new UpdateService({ version: '0.9.5-beta', stateDir, fetchImpl: async () => new Response(JSON.stringify(releases), { status: 200 }) })
    const checked = await updates.check()
    assert.equal(checked.releaseStatus, 'no-release')
    assert.equal(checked.latestVersion, null)
    assert.equal(checked.available, false)
  } finally { await rm(stateDir, { recursive: true, force: true }) }
})

test('an older published release is reported but cannot be installed', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'stgtime-older-release-'))
  let triggered = false
  const release = {
    tag_name: 'v0.9.0-alpha',
    assets: [{ name: 'stgtime-rpi4-arm64-0.9.0-alpha.tar.gz', size: 1234, browser_download_url: 'https://example.invalid/update.tar.gz', digest: `sha256:${'b'.repeat(64)}` }]
  }
  try {
    const updates = new UpdateService({ version: '0.9.1-alpha', stateDir, fetchImpl: async () => new Response(JSON.stringify([release]), { status: 200 }), trigger: async () => { triggered = true } })
    const checked = await updates.check()
    assert.equal(checked.releaseStatus, 'installed-newer')
    assert.equal(checked.available, false)
    await assert.rejects(() => updates.installLatest(), /no_update_available/)
    assert.equal(triggered, false)
  } finally { await rm(stateDir, { recursive: true, force: true }) }
})

test('offline update upload is streamed and queued with its computed digest', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'stgtime-upload-'))
  let triggered = false
  try {
    const updates = new UpdateService({ version: '1.0.0', stateDir, trigger: async () => { triggered = true } })
    const payload = Buffer.alloc(2048, 42)
    const result = await updates.upload(Readable.from([payload.subarray(0, 700), payload.subarray(700)]))
    assert.equal(result.size, payload.length)
    assert.equal(triggered, true)
    const request = JSON.parse(await readFile(join(stateDir, 'request.json'), 'utf8'))
    assert.equal(request.source, 'upload')
    assert.equal(request.sha256, result.sha256)
    assert.deepEqual(await readFile(join(stateDir, 'update.tar.gz')), payload)
  } finally { await rm(stateDir, { recursive: true, force: true }) }
})
