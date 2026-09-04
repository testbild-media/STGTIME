import { readFile } from 'node:fs/promises'
import { openStreamDeck } from '@elgato-stream-deck/node'
import jpeg from 'jpeg-js'
import { createKeyImage } from './bitmap.mjs'

const info = JSON.parse(process.argv[2])
const apiBase = process.env.STGTIME_API_URL || 'http://127.0.0.1:8080'
const configPath = process.env.STGTIME_CONFIG || '/var/lib/stgtime/config.json'
let apiToken = process.env.STGTIME_API_TOKEN || ''
let deck
let page = 'home'
let rendering = false
let renderQueued = false
let inputBusy = false
const tileCache = new Map()
const jpegCache = new Map()

async function encodeJpeg(buffer, width, height) {
  let hash = 2166136261
  for (const byte of buffer) hash = Math.imul(hash ^ byte, 16777619)
  const key = `${width}x${height}:${hash >>> 0}`
  const cached = jpegCache.get(key)
  if (cached) return cached
  const rgba = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const encoded = jpeg.encode({ data: rgba, width, height }, 85).data
  jpegCache.set(key, encoded)
  if (jpegCache.size > 512) jpegCache.delete(jpegCache.keys().next().value)
  return encoded
}

const profiles = {
  15: { name: 'Stream Deck Classic', time: [6, 7, 8], setup: 4, toggle: 11, reset: 13, mode: 14, presets: [0, 1, 2, 3], editTime: [1, 2, 3], plus: [6, 7, 8], minus: [11, 12, 13], back: 4 },
  32: { name: 'Stream Deck XL', time: [13, 14, 15], setup: 7, toggle: 21, reset: 23, mode: 31, presets: [0, 1, 2, 3], editTime: [13, 14, 15], plus: [9, 10, 11], minus: [17, 18, 19], back: 7 },
  8: { name: 'Stream Deck +', time: [1, 2, 3], setup: 0, toggle: 5, reset: 7, mode: 4, presets: [6], editTime: [1, 2, 3], plus: [1, 2, 3], minus: [5, 6, 7], back: 0 }
}

async function loadToken() { if (!apiToken) apiToken = JSON.parse(await readFile(configPath, 'utf8')).security.apiToken }
async function api(path, options = {}) {
  await loadToken()
  let response = await fetch(`${apiBase}${path}`, { ...options, headers: { 'content-type': 'application/json', authorization: `Bearer ${apiToken}` } })
  if (response.status === 401 && !process.env.STGTIME_API_TOKEN) {
    apiToken = ''
    await loadToken()
    response = await fetch(`${apiBase}${path}`, { ...options, headers: { 'content-type': 'application/json', authorization: `Bearer ${apiToken}` } })
  }
  if (!response.ok) throw new Error(`STGTIME API ${response.status}`)
  return response.json()
}

const parts = ms => {
  const seconds = Math.floor(Math.abs(ms) / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(number => String(number).padStart(2, '0'))
}

function button(index) { return deck.CONTROLS.find(control => control.type === 'button' && control.index === index) }

async function clearButtons() {
  tileCache.clear()
  for (const control of deck.CONTROLS) {
    if (control.type === 'button') await deck.clearKey(control.index)
  }
}

async function fill(index, options) {
  const control = button(index)
  if (!control || control.feedbackType !== 'lcd') return
  const cacheKey = JSON.stringify(options)
  if (tileCache.get(index) === cacheKey) return
  const width = control.pixelSize.width
  const height = control.pixelSize.height
  await deck.fillKeyBuffer(index, createKeyImage(width, height, options), { format: 'rgba' })
  tileCache.set(index, cacheKey)
}

async function render(state, profile) {
  if (!profile) {
    const buttons = deck.CONTROLS.filter(control => control.type === 'button')
    if (buttons[0]) await fill(buttons[0].index, { label: 'NOT', accent: '#ff0000' })
    if (buttons[1]) await fill(buttons[1].index, { label: 'SUPPORTED', accent: '#ff0000' })
    return
  }
  if (page === 'set') {
    const duration = parts(state.timer.durationMs)
    for (let i = 0; i < profile.editTime.length; i += 1) await fill(profile.editTime[i], { label: ['HOURS', 'MINUTES', 'SECONDS'][i], value: duration[i], accent: '#2a8798' })
    for (let i = 0; i < profile.plus.length; i += 1) await fill(profile.plus[i], { label: `+1 ${['HOUR', 'MIN', 'SEC'][i]}`, accent: '#00e56b' })
    for (let i = 0; i < profile.minus.length; i += 1) await fill(profile.minus[i], { label: `-1 ${['HOUR', 'MIN', 'SEC'][i]}`, accent: '#ff3b3b' })
    await fill(profile.back, { label: 'BACK', accent: '#ff6900' })
    return
  }

  const time = parts(state.timer.valueMs)
  const accent = state.timer.running ? '#00e56b' : '#ff6900'
  for (let i = 0; i < profile.time.length; i += 1) await fill(profile.time[i], { label: ['HOURS', 'MINUTES', 'SECONDS'][i], value: time[i], accent })
  await fill(profile.setup, { label: 'SET TIME', accent: '#2a8798' })
  await fill(profile.toggle, { label: state.timer.running ? 'STOP' : 'START', accent: state.timer.running ? '#ff3b3b' : '#00e56b' })
  await fill(profile.reset, { label: 'RESET' })
  await fill(profile.mode, { label: state.timer.mode === 'countdown' ? 'COUNT DOWN' : 'STOP WATCH', accent: '#8855dd' })
  const presets = ['5 MIN', '10 MIN', '15 MIN', '30 MIN']
  for (let i = 0; i < profile.presets.length; i += 1) await fill(profile.presets[i], { label: presets[i], accent: '#2a8798' })
}

async function scheduleRender(profile) {
  if (rendering) { renderQueued = true; return }
  rendering = true
  do {
    renderQueued = false
    try { await render(await api('/api/v1/state'), profile) } catch (error) { console.error(`${profile?.name || info.model}: ${error.message}`) }
  } while (renderQueued)
  rendering = false
}

async function handleButton(control, profile) {
  if (control.type !== 'button' || !profile || inputBusy) return
  inputBusy = true
  try {
    const presetIndex = profile.presets.indexOf(control.index)
    if (page === 'set') {
      if (control.index === profile.back) {
        page = 'home'
        await clearButtons()
      } else {
        const plusIndex = profile.plus.indexOf(control.index)
        const minusIndex = profile.minus.indexOf(control.index)
        const unitIndex = plusIndex >= 0 ? plusIndex : minusIndex
        if (unitIndex >= 0) {
          const state = await api('/api/v1/state')
          const units = [3_600_000, 60_000, 1_000]
          const delta = units[unitIndex] * (plusIndex >= 0 ? 1 : -1)
          await api('/api/v1/timer', { method: 'PUT', body: JSON.stringify({ durationMs: Math.max(0, state.timer.durationMs + delta) }) })
        }
      }
    } else if (control.index === profile.setup) {
      page = 'set'
      await clearButtons()
    } else if (control.index === profile.toggle) await api('/api/v1/timer/action', { method: 'POST', body: JSON.stringify({ action: 'toggle' }) })
    else if (control.index === profile.reset) await api('/api/v1/timer/action', { method: 'POST', body: JSON.stringify({ action: 'reset' }) })
    else if (control.index === profile.mode) {
      const state = await api('/api/v1/state')
      await api('/api/v1/timer', { method: 'PUT', body: JSON.stringify({ mode: state.timer.mode === 'countdown' ? 'stopwatch' : 'countdown' }) })
    } else if (presetIndex >= 0) await api(`/api/v1/presets/${['five', 'ten', 'fifteen', 'thirty'][presetIndex]}`, { method: 'POST' })
  } catch (error) { console.error(`${profile.name} input: ${error.message}`) }
  finally { inputBusy = false; await scheduleRender(profile) }
}

try {
  await loadToken()
  console.log(`${info.model || 'Stream Deck'} worker starting`)
  deck = await openStreamDeck(info.path, { encodeJPEG: encodeJpeg })
  console.log(`${info.model || 'Stream Deck'} HID opened`)
  const buttonCount = deck.CONTROLS.filter(control => control.type === 'button').length
  const profile = profiles[buttonCount]
  deck.on('error', error => { console.error(`${profile?.name || info.model} HID error: ${error.message}`); process.exit(1) })
  deck.on('down', control => { handleButton(control, profile).catch(error => console.error(error.message)) })
  await deck.setBrightness(80).catch(() => {})
  await clearButtons()
  console.log(`${profile?.name || info.model} keys cleared sequentially`)
  console.log(`${profile?.name || info.model} software JPEG encoder active`)
  await scheduleRender(profile)
  console.log(`${profile?.name || `Unsupported ${buttonCount}-button Stream Deck`} connected and labeled`)
  setInterval(() => scheduleRender(profile), 1000)
} catch (error) {
  console.error(`${info.model || 'Stream Deck'} initialization failed: ${error.stack || error.message}`)
  process.exit(1)
}

async function shutdown() {
  if (deck) await deck.close().catch(() => {})
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
process.on('disconnect', shutdown)
