export function proportionalPresetThresholds(durationMs) {
  const duration = Math.max(0, Math.trunc(Number(durationMs) || 0))
  return {
    warning: Math.round(duration / 6 / 1000) * 1000,
    critical: Math.round(duration / 12 / 1000) * 1000
  }
}

export function normalizePreset(item, index = 0) {
  const durationMs = Math.max(0, Math.trunc(Number(item.durationMs) || 0))
  const suggested = proportionalPresetThresholds(durationMs)
  const warning = Number.isFinite(Number(item.thresholdsMs?.warning)) ? Math.trunc(Number(item.thresholdsMs.warning)) : suggested.warning
  const critical = Number.isFinite(Number(item.thresholdsMs?.critical)) ? Math.trunc(Number(item.thresholdsMs.critical)) : suggested.critical
  if (warning < 0 || critical < 0 || warning > durationMs || critical > warning) {
    throw Object.assign(new Error('invalid_preset_thresholds'), { status: 400 })
  }
  return {
    id: String(item.id || `preset-${index + 1}`).replace(/[^a-z0-9-]/gi, '-').slice(0, 40),
    name: String(item.name || `Preset ${index + 1}`).slice(0, 40),
    durationMs,
    thresholdsMs: { warning, critical }
  }
}
