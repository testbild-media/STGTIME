import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const parseVersion = value => {
  const version = String(value || '').replace(/^v/i, '')
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9a-z.-]+))?(?:\+[0-9a-z.-]+)?$/i.exec(version)
  if (!match) return null
  return {
    version,
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split('.').map(part => /^\d+$/.test(part) ? Number(part) : part.toLowerCase()) || []
  }
}

const releaseVersion = release => parseVersion(release?.tag_name)?.version || null

export function compareVersions(left, right) {
  const a = parseVersion(left); const b = parseVersion(right)
  if (!a || !b) return String(left).localeCompare(String(right))
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    if (a.prerelease.length === b.prerelease.length) return 0
    return a.prerelease.length ? -1 : 1
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const av = a.prerelease[index]; const bv = b.prerelease[index]
    if (av === bv) continue
    if (av === undefined) return -1
    if (bv === undefined) return 1
    if (typeof av === typeof bv) return av < bv ? -1 : 1
    return typeof av === 'number' ? -1 : 1
  }
  return 0
}

export function releaseStatus(installedVersion, latestVersion) {
  if (!latestVersion) return 'no-release'
  const comparison = compareVersions(installedVersion, latestVersion)
  if (comparison < 0) return 'update-available'
  if (comparison > 0) return 'installed-newer'
  return 'up-to-date'
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

export class UpdateService {
  constructor({ version, repository = 'testbild-media/STGTIME', stateDir = '/var/lib/stgtime/update', trigger, fetchImpl = fetch } = {}) {
    this.version = version
    this.repository = repository
    this.stateDir = stateDir
    this.fetch = fetchImpl
    this.trigger = trigger || (async () => {
      if (process.platform !== 'linux') return
      await run('sudo', ['/usr/bin/systemctl', 'start', '--no-block', 'stgtime-update.service'], { timeout: 10_000 })
    })
  }

  async updaterStatus() {
    try { return JSON.parse(await readFile(`${this.stateDir}/status.json`, 'utf8')) } catch { return { state: 'idle', message: 'No update has been installed yet', version: null } }
  }

  async status() {
    let cached = { installedVersion: this.version, latestVersion: null, available: false, releaseNotes: '' }
    try { cached = JSON.parse(await readFile(`${this.stateDir}/latest.json`, 'utf8')) } catch {}
    const currentReleaseStatus = releaseStatus(this.version, cached.latestVersion)
    return { ...cached, installedVersion: this.version, releaseStatus: currentReleaseStatus, available: currentReleaseStatus === 'update-available', updater: await this.updaterStatus() }
  }

  async ensureIdle() {
    const { state } = await this.updaterStatus()
    if (['queued', 'preparing', 'downloading', 'installing', 'verifying'].includes(state)) throw Object.assign(new Error('update_already_in_progress'), { status: 409 })
  }

  async check() {
    const response = await this.fetch(`https://api.github.com/repos/${this.repository}/releases?per_page=100`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `STGTIME/${this.version}`, 'x-github-api-version': '2026-03-10' },
      signal: AbortSignal.timeout(12_000)
    })
    if (response.status === 404) {
      const result = { installedVersion: this.version, available: false, releaseStatus: 'no-release', latestVersion: null, message: 'No published release found', checkedAt: new Date().toISOString() }
      await mkdir(this.stateDir, { recursive: true, mode: 0o750 }); await writeJsonAtomic(`${this.stateDir}/latest.json`, result)
      return { ...result, updater: await this.updaterStatus() }
    }
    if (!response.ok) throw Object.assign(new Error(`GitHub update check failed (${response.status})`), { status: 502 })
    const releases = await response.json()
    const release = (Array.isArray(releases) ? releases : [])
      .filter(item => !item.draft && releaseVersion(item))
      .sort((left, right) => compareVersions(releaseVersion(right), releaseVersion(left)))[0]
    if (!release) {
      const result = { installedVersion: this.version, available: false, releaseStatus: 'no-release', latestVersion: null, message: 'No published release found', checkedAt: new Date().toISOString() }
      await mkdir(this.stateDir, { recursive: true, mode: 0o750 }); await writeJsonAtomic(`${this.stateDir}/latest.json`, result)
      return { ...result, updater: await this.updaterStatus() }
    }
    const latestVersion = releaseVersion(release)
    const currentReleaseStatus = releaseStatus(this.version, latestVersion)
    const asset = release.assets?.find(item => /^stgtime-rpi4-arm64-.+\.tar\.gz$/i.test(item.name))
    const digest = String(asset?.digest || '')
    const result = {
      installedVersion: this.version,
      latestVersion,
      available: currentReleaseStatus === 'update-available',
      releaseStatus: currentReleaseStatus,
      releaseName: release.name || release.tag_name,
      releaseNotes: release.body || '',
      releaseUrl: release.html_url,
      publishedAt: release.published_at,
      prerelease: Boolean(release.prerelease),
      asset: asset ? { name: asset.name, size: asset.size, url: asset.browser_download_url, sha256: digest.startsWith('sha256:') ? digest.slice(7) : null } : null,
      checkedAt: new Date().toISOString()
    }
    await mkdir(this.stateDir, { recursive: true, mode: 0o750 }); await writeJsonAtomic(`${this.stateDir}/latest.json`, result)
    return { ...result, updater: await this.updaterStatus() }
  }

  async installLatest() {
    await this.ensureIdle()
    const update = await this.check()
    if (!update.available) throw Object.assign(new Error('no_update_available'), { status: 409 })
    if (!update.asset?.sha256) throw Object.assign(new Error('release_asset_has_no_sha256_digest'), { status: 409 })
    await mkdir(this.stateDir, { recursive: true, mode: 0o750 })
    await writeJsonAtomic(`${this.stateDir}/request.json`, { source: 'github', version: update.latestVersion, url: update.asset.url, sha256: update.asset.sha256 })
    await writeJsonAtomic(`${this.stateDir}/status.json`, { state: 'queued', message: 'Update queued', version: update.latestVersion, updatedAt: new Date().toISOString() })
    try { await this.trigger() } catch (error) {
      await writeJsonAtomic(`${this.stateDir}/status.json`, { state: 'failed', message: 'Could not start the updater', version: update.latestVersion, updatedAt: new Date().toISOString() })
      throw error
    }
    return { accepted: true, version: update.latestVersion }
  }

  async upload(req, { maxBytes = 128 * 1024 * 1024 } = {}) {
    await this.ensureIdle()
    await mkdir(this.stateDir, { recursive: true, mode: 0o750 })
    const temporary = `${this.stateDir}/upload.tar.gz.tmp`
    const archive = `${this.stateDir}/update.tar.gz`
    const hash = createHash('sha256')
    let size = 0
    const file = await open(temporary, 'w', 0o600)
    try {
      for await (const chunk of req) {
        size += chunk.length
        if (size > maxBytes) throw Object.assign(new Error('update_archive_too_large'), { status: 413 })
        hash.update(chunk)
        await file.write(chunk)
      }
      await file.close()
      if (size < 1024) throw Object.assign(new Error('update_archive_is_empty'), { status: 400 })
      await rename(temporary, archive)
      const sha256 = hash.digest('hex')
      await writeJsonAtomic(`${this.stateDir}/request.json`, { source: 'upload', version: null, sha256 })
      await writeJsonAtomic(`${this.stateDir}/status.json`, { state: 'queued', message: 'Uploaded update queued', version: null, updatedAt: new Date().toISOString() })
      try { await this.trigger() } catch (error) {
        await writeJsonAtomic(`${this.stateDir}/status.json`, { state: 'failed', message: 'Could not start the updater', version: null, updatedAt: new Date().toISOString() })
        throw error
      }
      return { accepted: true, size, sha256 }
    } catch (error) {
      await file.close().catch(() => {})
      await rm(temporary, { force: true }).catch(() => {})
      throw error
    }
  }
}
