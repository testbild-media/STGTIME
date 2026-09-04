import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes, scryptSync } from 'node:crypto'
import { proportionalPresetThresholds } from './preset.mjs'

const clone = value => structuredClone(value)

export function mergeConfig(base, update) {
  if (Array.isArray(base) || Array.isArray(update)) return clone(update)
  if (!base || typeof base !== 'object' || !update || typeof update !== 'object') return clone(update)
  const result = clone(base)
  for (const [key, value] of Object.entries(update)) {
    result[key] = key in result && value && typeof value === 'object' && !Array.isArray(value)
      ? mergeConfig(result[key], value)
      : clone(value)
  }
  return result
}

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`
}

export class ConfigStore {
  constructor({ defaultsPath, dataPath }) {
    this.defaultsPath = defaultsPath
    this.dataPath = dataPath
    this.config = null
  }

  async load() {
    const defaults = JSON.parse(await readFile(this.defaultsPath, 'utf8'))
    let persisted = {}
    try { persisted = JSON.parse(await readFile(this.dataPath, 'utf8')) } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if ((persisted.schemaVersion || 1) < 2) {
      persisted.schemaVersion = 2
      persisted.display = { ...persisted.display, pwmBits: defaults.display.pwmBits, limitRefreshRateHz: defaults.display.limitRefreshRateHz }
    }
    if ((persisted.schemaVersion || 1) < 3) {
      persisted.schemaVersion = 3
      if (Array.isArray(persisted.presets)) persisted.presets = persisted.presets.map(preset => {
        const durationMs = Math.max(0, Math.trunc(Number(preset.durationMs) || 0))
        const suggested = proportionalPresetThresholds(durationMs)
        const warning = Math.min(durationMs, Math.max(0, Number.isFinite(Number(preset.thresholdsMs?.warning)) ? Math.trunc(Number(preset.thresholdsMs.warning)) : suggested.warning))
        const critical = Math.min(warning, Math.max(0, Number.isFinite(Number(preset.thresholdsMs?.critical)) ? Math.trunc(Number(preset.thresholdsMs.critical)) : suggested.critical))
        return { ...preset, durationMs, thresholdsMs: { warning, critical } }
      })
    }
    this.config = mergeConfig(defaults, persisted)
    if (!this.config.security.passwordHash) this.config.security.passwordHash = hashPassword('stagetimer')
    if (!this.config.security.apiToken) this.config.security.apiToken = randomBytes(24).toString('base64url')
    await this.save()
    return this.get()
  }

  get() { return clone(this.config) }

  async update(patch) {
    this.config = mergeConfig(this.config, patch)
    await this.save()
    return this.get()
  }

  async save() {
    await mkdir(dirname(this.dataPath), { recursive: true })
    const temporary = `${this.dataPath}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.config, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.dataPath)
  }
}
