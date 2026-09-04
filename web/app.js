const $ = selector => document.querySelector(selector)
const $$ = selector => [...document.querySelectorAll(selector)]
const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
let config = null
let state = null
let toastTimer
let shownDuration = null
let ethernetStatus = null
let availableUpdate = null
let updateCheckFailed = false

function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200) }

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
  if (response.status === 401) { $('#login-dialog').showModal(); throw new Error('Authentication required') }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data
}

const parseTime = value => { const parts = value.split(':').map(Number); return ((parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0)) * 1000 }
const formatTime = (ms, mode = 'HH:MM:SS') => {
  const sign = ms < 0 ? '−' : ''; const total = Math.floor(Math.abs(ms) / 1000); const h = Math.floor(total / 3600); const m = mode === 'MM:SS' ? Math.floor(total / 60) : Math.floor(total % 3600 / 60); const s = total % 60
  return sign + (mode === 'MM:SS' ? `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`)
}
const suggestedPresetThresholds = durationMs => ({ warning: Math.round(durationMs / 6 / 1000) * 1000, critical: Math.round(durationMs / 12 / 1000) * 1000 })

function timeZoneOffset(timeZone, date = new Date()) {
  try {
    const name = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find(part => part.type === 'timeZoneName')?.value
    if (name === 'GMT' || name === 'UTC') return 'UTC+00:00'
    if (/^GMT[+-]\d{2}:\d{2}$/.test(name)) return name.replace('GMT', 'UTC')
  } catch {}

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(date)
    const value = type => Number(parts.find(part => part.type === type)?.value)
    const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'))
    const minutes = Math.round((asUtc - date.getTime()) / 60000)
    const absolute = Math.abs(minutes)
    return `UTC${minutes < 0 ? '−' : '+'}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
  } catch {
    return 'UTC offset unavailable'
  }
}

function paintTimeZones(selected) {
  const fallback = ['UTC', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney']
  const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : fallback
  const zones = ['UTC', ...supported.filter(zone => zone !== 'UTC')]
  if (selected && !zones.includes(selected)) zones.push(selected)
  $('#clock-time-zone').innerHTML = zones.map(zone => `<option value="${escapeHtml(zone)}">${timeZoneOffset(zone)} — ${escapeHtml(zone.replaceAll('_', ' '))}</option>`).join('')
  $('#clock-time-zone').value = selected || 'UTC'
}

function paintEthernetFields() {
  if (!config) return
  const dhcp = $('#ethernet-mode').value === 'dhcp'
  const values = dhcp
    ? (ethernetStatus || { address: '', gateway: '', dns: '' })
    : { address: config.network.ethernetAddress, gateway: config.network.ethernetGateway, dns: config.network.ethernetDns }
  const fields = [
    ['#ethernet-address', values.address],
    ['#ethernet-gateway', values.gateway],
    ['#ethernet-dns', values.dns]
  ]
  for (const [selector, value] of fields) {
    const field = $(selector)
    field.value = value || ''
    field.disabled = dhcp
  }
}

function paintState() {
  if (!state) return
  $('#timer-value').textContent = formatTime(state.timer.valueMs, config?.display.format)
  const timeInputs = [$('#hours'), $('#minutes'), $('#seconds')]
  if (state.timer.durationMs !== shownDuration && !timeInputs.includes(document.activeElement)) {
    const total = Math.floor(state.timer.durationMs / 1000); $('#hours').value = Math.floor(total / 3600); $('#minutes').value = Math.floor(total % 3600 / 60); $('#seconds').value = total % 60; shownDuration = state.timer.durationMs
  }
  $('#run-status').textContent = state.timer.running ? 'Running' : 'Stopped'; $('#run-status').classList.toggle('running', state.timer.running)
  $('#toggle').textContent = state.timer.running ? 'Stop' : 'Start'
  $('#display-driver').textContent = `${state.display.driver} · ${state.display.available ? 'ready' : 'unavailable'}`
  $('#installed-version').textContent = state.system.version || 'Unknown'
  $('#update-installed').textContent = state.system.version || 'Unknown'
  $('#addresses').textContent = state.system.addresses.map(item => item.address).join(', ') || 'No network address'
  $('[data-mode="countdown"]').classList.toggle('selected', state.timer.mode === 'countdown'); $('[data-mode="stopwatch"]').classList.toggle('selected', state.timer.mode === 'stopwatch')
}

function paintConfig() {
  $('#brightness').value = config.display.brightness; $('#brightness-output').textContent = `${config.display.brightness}%`; $('#time-format').value = config.display.format; $('#clock-visible').checked = config.display.clockVisible; $('#clock-color').value = config.display.clockColor; paintTimeZones(config.display.timeZone)
  $('#normal-color').value = config.timer.colors.normal; $('#warning-color').value = config.timer.colors.warning; $('#critical-color').value = config.timer.colors.critical
  $('#warning-time').value = formatTime(config.timer.thresholdsMs.warning); $('#critical-time').value = formatTime(config.timer.thresholdsMs.critical); $('#continue-negative').checked = config.timer.continueNegative; $('#blink-end').checked = config.timer.blinkAtEnd
  $('#message-visible').checked = config.message.visible; $('#message-text').value = config.message.text; $('#message-color').value = config.message.color
  $('#hotspot-mode').value = config.network.hotspotMode; $('#hotspot-ssid').value = config.network.hotspotSsid; $('#hotspot-password').value = config.network.hotspotPassword; $('#ethernet-mode').value = config.network.ethernetMode; paintEthernetFields()
  $('#auth-mode').value = config.security.webAuthMode
  $('#preset-grid').innerHTML = config.presets.map(preset => { const thresholds = preset.thresholdsMs || suggestedPresetThresholds(preset.durationMs); return `<article class="panel preset"><button class="preset-load" data-preset="${escapeHtml(preset.id)}"><small>${escapeHtml(preset.name)}</small><b>${formatTime(preset.durationMs)}</b><span class="preset-thresholds">Warning ${formatTime(thresholds.warning)} · Critical ${formatTime(thresholds.critical)}</span><span>Load preset →</span></button><button class="preset-delete" data-delete-preset="${escapeHtml(preset.id)}">Delete</button></article>` }).join('')
  $$('[data-preset]').forEach(button => button.onclick = () => act(`/api/v1/presets/${button.dataset.preset}`, { method: 'POST' }, 'Preset loaded'))
  $$('[data-delete-preset]').forEach(button => button.onclick = () => savePresets(config.presets.filter(item => item.id !== button.dataset.deletePreset), 'Preset deleted'))
}

async function refresh() {
  try { state = await api('/api/v1/state'); paintState(); $('#connection').textContent = 'Online'; $('#connection').style.color = 'var(--green)' }
  catch (error) { if (!error.message.includes('Authentication')) { $('#connection').textContent = 'Offline'; $('#connection').style.color = 'var(--red)' } }
}
async function refreshNetworkStatus() { try { const result = await api('/api/v1/network'); ethernetStatus = result.ethernet; paintEthernetFields() } catch {} }
async function act(path, options, success) { try { const result = await api(path, options); if (result.timer) state = result; await refresh(); if (success) toast(success); return true } catch (error) { if (!error.message.includes('Authentication')) toast(error.message); return false } }
async function saveConfig(patch, success) { try { config = await api('/api/v1/config', { method: 'PUT', body: JSON.stringify(patch) }); paintConfig(); toast(success); return true } catch (error) { toast(error.message); return false } }
async function savePresets(presets, success) { try { const result = await api('/api/v1/presets', { method: 'PUT', body: JSON.stringify({ presets }) }); config.presets = result.presets; paintConfig(); toast(success) } catch (error) { toast(error.message) } }
async function saveMessage(patch, success) { try { config.message = await api('/api/v1/message', { method: 'PUT', body: JSON.stringify(patch) }); $('#message-visible').checked = config.message.visible; $('#message-text').value = config.message.text; $('#message-color').value = config.message.color; toast(success) } catch (error) { $('#message-visible').checked = config.message.visible; toast(error.message) } }

function paintUpdate(update) {
  const status = update.updater || update
  if (update.installedVersion) $('#update-installed').textContent = update.installedVersion
  $('#update-latest').textContent = update.latestVersion || (update.checkedAt ? 'No release found' : 'Not checked')
  const busy = ['queued', 'preparing', 'downloading', 'installing', 'verifying'].includes(status.state)
  let stateText = status.state !== 'idle' ? status.state.replaceAll('-', ' ') : 'Not checked'
  let message = status.message || 'Check GitHub for a published STGTIME release, or upload an update package from this device.'
  if (!busy && status.state === 'idle') {
    if (update.releaseStatus === 'update-available') {
      stateText = 'Update available'
      message = `Update available: ${update.installedVersion} → ${update.latestVersion}`
    } else if (update.releaseStatus === 'up-to-date') {
      stateText = 'Up to date'
      message = `Current version ${update.installedVersion} is installed.`
    } else if (update.releaseStatus === 'installed-newer') {
      stateText = 'Installed version is newer'
      message = `Installed version ${update.installedVersion} is newer than release ${update.latestVersion}. Downgrades are disabled.`
    } else if (update.checkedAt) {
      stateText = 'No release found'
      message = update.message || 'GitHub has no published STGTIME release.'
    }
  }
  if (update.releaseNotes && update.releaseStatus === 'update-available') message += `\n\n${update.releaseNotes}`
  $('#update-notes').textContent = message
  $('#update-state').textContent = stateText
  $('#update-state').classList.toggle('running', update.available || busy)
  $('#update-state').classList.toggle('error', status.state === 'failed')
  availableUpdate = update.available && update.asset?.sha256 ? update : null
  $('#install-update').disabled = !availableUpdate
}

async function refreshUpdate(remote = false) {
  const button = $('#check-update')
  if (remote) { button.disabled = true; button.textContent = 'Checking…' }
  try {
    const update = await api(remote ? '/api/v1/update' : '/api/v1/update/status')
    if (!remote && updateCheckFailed && update.updater?.state === 'idle') return
    if (remote) updateCheckFailed = false
    paintUpdate(update)
    if (remote) toast(update.releaseStatus === 'update-available' ? `Update ${update.latestVersion} is available` : update.releaseStatus === 'installed-newer' ? 'Installed version is newer; downgrade disabled' : update.releaseStatus === 'up-to-date' ? 'Current version is installed' : 'No published release found')
  } catch (error) {
    if (remote) {
      updateCheckFailed = true
      availableUpdate = null
      $('#install-update').disabled = true
      $('#update-state').textContent = 'Check failed'
      $('#update-state').classList.remove('running')
      $('#update-state').classList.add('error')
      $('#update-latest').textContent = 'Unavailable'
      $('#update-notes').textContent = 'Could not contact the update server. Check the device internet connection and try again.'
      toast('Update server unavailable')
    }
  } finally {
    if (remote) { button.disabled = false; button.textContent = 'Check for updates' }
  }
}

$$('.nav-item').forEach(button => button.onclick = () => { $$('.nav-item').forEach(item => item.classList.remove('active')); $$('.page').forEach(page => page.classList.remove('active')); button.classList.add('active'); $(`#page-${button.dataset.page}`).classList.add('active'); scrollTo({ top: 0, behavior: 'smooth' }) })
$$('[data-mode]').forEach(button => button.onclick = () => act('/api/v1/timer', { method: 'PUT', body: JSON.stringify({ mode: button.dataset.mode }) }, `${button.textContent} selected`))
$('#toggle').onclick = () => act('/api/v1/timer/action', { method: 'POST', body: JSON.stringify({ action: 'toggle' }) })
$('#reset').onclick = () => act('/api/v1/timer/action', { method: 'POST', body: JSON.stringify({ action: 'reset' }) })
$('#set-time').onclick = () => act('/api/v1/timer', { method: 'PUT', body: JSON.stringify({ durationMs: (+$('#hours').value * 3600 + +$('#minutes').value * 60 + +$('#seconds').value) * 1000 }) }, 'Time set')
$$('[data-jog]').forEach(button => button.onclick = () => act('/api/v1/timer', { method: 'PUT', body: JSON.stringify({ jogMs: +button.dataset.jog }) }))
$('#message-visible').oninput = event => {
  const visible = event.currentTarget.checked
  saveMessage(visible ? { visible, text: $('#message-text').value, color: $('#message-color').value } : { visible }, visible ? 'Message shown' : 'Message hidden')
}
$('#message-apply').onclick = () => saveMessage({ text: $('#message-text').value, color: $('#message-color').value }, 'Message content updated')
$('#preset-time').onchange = () => { const suggested = suggestedPresetThresholds(parseTime($('#preset-time').value)); $('#preset-warning').value = formatTime(suggested.warning); $('#preset-critical').value = formatTime(suggested.critical) }
$('#add-preset').onclick = () => {
  const name = $('#preset-name').value.trim()
  if (!name) return toast('Enter a preset name')
  const durationMs = parseTime($('#preset-time').value)
  const thresholdsMs = { warning: parseTime($('#preset-warning').value), critical: parseTime($('#preset-critical').value) }
  if (thresholdsMs.warning > durationMs || thresholdsMs.critical > thresholdsMs.warning) return toast('Use Duration ≥ Warning ≥ Critical')
  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString(36)}`
  savePresets([...config.presets, { id, name, durationMs, thresholdsMs }], 'Preset added')
}
$('#brightness').oninput = () => $('#brightness-output').textContent = `${$('#brightness').value}%`
$('#save-display').onclick = () => saveConfig({ display: { brightness: +$('#brightness').value, format: $('#time-format').value, clockVisible: $('#clock-visible').checked, clockColor: $('#clock-color').value, timeZone: $('#clock-time-zone').value } }, 'Display settings saved')
$('#save-timer-style').onclick = () => saveConfig({ timer: { continueNegative: $('#continue-negative').checked, blinkAtEnd: $('#blink-end').checked, colors: { normal: $('#normal-color').value, warning: $('#warning-color').value, critical: $('#critical-color').value }, thresholdsMs: { warning: parseTime($('#warning-time').value), critical: parseTime($('#critical-time').value) } } }, 'Timer settings saved')
$('#ethernet-mode').onchange = paintEthernetFields
$('#apply-network').onclick = async () => {
  const ethernetMode = $('#ethernet-mode').value
  const network = { ethernetMode }
  if (ethernetMode === 'static') Object.assign(network, { ethernetAddress: $('#ethernet-address').value, ethernetGateway: $('#ethernet-gateway').value, ethernetDns: $('#ethernet-dns').value })
  if (!await saveConfig({ network }, 'Network settings saved')) return
  if (await act('/api/v1/network/apply', { method: 'POST', body: JSON.stringify({ action: ethernetMode === 'dhcp' ? 'ethernet-dhcp' : 'ethernet-static' }) }, 'Network settings applied')) await refreshNetworkStatus()
}
$('#hotspot-on').onclick = async () => {
  if (!await saveConfig({ network: { hotspotSsid: $('#hotspot-ssid').value, hotspotPassword: $('#hotspot-password').value, hotspotMode: $('#hotspot-mode').value } }, 'Hotspot settings saved')) return
  await act('/api/v1/network/apply', { method: 'POST', body: JSON.stringify({ action: 'hotspot-on' }) }, 'Hotspot started')
}
$('#hotspot-off').onclick = () => act('/api/v1/network/apply', { method: 'POST', body: JSON.stringify({ action: 'hotspot-off' }) }, 'Hotspot stopped')
$('#change-password').onclick = async () => {
  const currentPassword = $('#current-password').value
  const newPassword = $('#new-password').value
  const retypedPassword = $('#retype-password').value
  if (!currentPassword) return toast('Enter the current admin password')
  if (newPassword.length < 8) return toast('New password must have at least 8 characters')
  if (newPassword !== retypedPassword) return toast('New passwords do not match')
  try {
    await api('/api/v1/security/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) })
    $('#current-password').value = ''
    $('#new-password').value = ''
    $('#retype-password').value = ''
    $('#login-password').value = ''
    toast('Password changed. Sign in again.')
    if (!$('#login-dialog').open) $('#login-dialog').showModal()
  } catch (error) {
    toast(error.message === 'current_password_is_incorrect' ? 'Current admin password is incorrect' : error.message)
  }
}
$('#save-auth-mode').onclick = () => act('/api/v1/security/mode', { method: 'PUT', body: JSON.stringify({ webAuthMode: $('#auth-mode').value }) }, 'Access policy saved')
$('#show-token').onclick = async () => { try { const result = await api('/api/v1/security/api-token'); $('#api-token').type = 'text'; $('#api-token').value = result.apiToken; $('#show-token').textContent = 'Token shown' } catch (error) { toast(error.message) } }
$('#rotate-token').onclick = async () => { if (!confirm('Rotate the API token? Existing Companion and API clients will stop working.')) return; try { const result = await api('/api/v1/security/api-token/rotate', { method: 'POST' }); $('#api-token').type = 'text'; $('#api-token').value = result.apiToken; toast('API token rotated') } catch (error) { toast(error.message) } }
$('#check-update').onclick = () => refreshUpdate(true)
$('#install-update').onclick = async () => {
  const password = $('#update-password').value
  if (!password) return toast('Enter the admin password')
  if (!confirm(`Install STGTIME ${availableUpdate?.latestVersion || 'update'}? The controls will briefly disconnect.`)) return
  if (await act('/api/v1/update/install', { method: 'POST', body: JSON.stringify({ password }) }, 'Update installation started')) { $('#install-update').disabled = true; setTimeout(() => refreshUpdate(), 1500) }
}
$('#upload-update').onclick = async () => {
  const file = $('#update-file').files[0]
  const password = $('#update-password').value
  if (!file) return toast('Choose an update package')
  if (!password) return toast('Enter the admin password')
  if (!confirm(`Install ${file.name}? The controls will briefly disconnect.`)) return
  try {
    await api('/api/v1/update/upload', { method: 'POST', headers: { 'content-type': 'application/gzip', 'x-stgtime-admin-password': password }, body: file })
    $('#upload-update').disabled = true
    toast('Update package accepted')
    setTimeout(() => refreshUpdate(), 1500)
  } catch (error) { toast(error.message) }
}
$('#logout').onclick = async () => { await api('/api/v1/auth/logout', { method: 'POST' }); $('#login-dialog').showModal() }
$('#login-form').onsubmit = async event => { event.preventDefault(); try { await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ password: $('#login-password').value }) }); $('#login-error').textContent = ''; $('#login-dialog').close(); config = await api('/api/v1/config'); paintConfig(); refresh() } catch (error) { $('#login-error').textContent = error.message } }

async function init() { try { config = await api('/api/v1/config'); paintConfig(); await Promise.all([refresh(), refreshNetworkStatus(), refreshUpdate()]) } catch {} setInterval(refresh, 500); setInterval(refreshNetworkStatus, 5000); setInterval(refreshUpdate, 5000); setInterval(() => { $('#display-preview').src = `/api/v1/display.png?t=${Date.now()}` }, 500) }
window.addEventListener('pageshow', () => { if (config) paintConfig() })
init()
