import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { renderDisplay, formatClockTime, formatDuration, formatMainTime } from '../src/display/renderer.mjs'
import { decodePng, encodePng } from '../src/display/framebuffer.mjs'

const settings = JSON.parse(await readFile(new URL('../config/default.json', import.meta.url), 'utf8'))

test('duration formatting supports both display modes and overtime', () => {
  assert.equal(formatDuration(3_723_000), '01:02:03')
  assert.equal(formatDuration(3_723_000, 'MM:SS'), '62:03')
  assert.equal(formatDuration(-1000), '-00:00:01')
})

test('negative main time always omits hours and remains meaningful past 59 minutes', () => {
  assert.equal(formatMainTime(-1000, 'HH:MM:SS'), '-00:01')
  assert.equal(formatMainTime(-3_723_000, 'HH:MM:SS'), '-62:03')
  assert.equal(formatMainTime(3_723_000, 'HH:MM:SS'), '01:02:03')
})

test('clock time is formatted in the configured IANA time zone', () => {
  const instant = new Date('2026-01-01T12:34:56Z')
  assert.equal(formatClockTime(instant, 'UTC'), '12:34:56')
  assert.equal(formatClockTime(instant, 'Europe/Berlin'), '13:34:56')
  assert.equal(formatClockTime(instant, 'Asia/Tokyo'), '21:34:56')
  assert.equal(formatClockTime(instant, 'Not/AZone'), '12:34:56')
})

test('renderer always produces the exact panel dimensions', () => {
  const frame = renderDisplay({ timer: { mode: 'countdown', valueMs: 300_000, durationMs: 600_000 }, bootMessage: null }, settings, new Date('2026-01-01T12:34:56Z'))
  assert.equal(frame.width, 64); assert.equal(frame.height, 32); assert.equal(frame.pixels.length, 64 * 32 * 3)
  const colors = new Set()
  for (let i = 0; i < frame.pixels.length; i += 3) colors.add(`${frame.pixels[i]},${frame.pixels[i + 1]},${frame.pixels[i + 2]}`)
  assert.ok(colors.size <= 6, 'bitmap rendering must not introduce antialias colors')
})

test('layout uses the full original 13+1+2+1+7+1+7 vertical grid', () => {
  const configured = structuredClone(settings)
  configured.video = { visible: true, label: 'VIDEO', remainingMs: 30_000, durationMs: 60_000, color: '#00ff48' }
  const frame = renderDisplay({ timer: { mode: 'countdown', valueMs: 300_000, durationMs: 600_000 }, bootMessage: null }, configured, new Date('2026-01-01T12:34:56Z'))
  const rowLit = y => frame.pixels.subarray(y * 64 * 3, (y + 1) * 64 * 3).some(value => value !== 0)
  const columnLit = x => Array.from({ length: 32 }, (_, y) => frame.pixels.subarray((y * 64 + x) * 3, (y * 64 + x + 1) * 3).some(value => value !== 0)).some(Boolean)
  assert.equal(rowLit(13), false, 'row between main time and progress bar must stay empty')
  assert.equal(rowLit(16), false, 'row below main progress bar must stay empty')
  assert.equal(rowLit(14), true, 'progress bar starts after the first gap')
  assert.equal(rowLit(15), true, 'progress bar is exactly two pixels high')
  assert.equal(rowLit(17), true, 'first lower line starts at row 17')
  assert.equal(rowLit(23), true, 'first lower line uses all seven rows')
  assert.equal(rowLit(24), false, 'row between both lower lines must stay empty')
  assert.equal(rowLit(25), true, 'second lower line starts at row 25')
  assert.equal(rowLit(31), true, 'second lower line reaches the final display row')
  assert.equal(columnLit(0), false, 'left edge must remain empty')
  assert.equal(columnLit(63), false, 'right edge must remain empty')
})

test('main timer leaves one blank pixel after each colon', () => {
  const frame = renderDisplay({ timer: { mode: 'countdown', valueMs: 600_000, durationMs: 600_000 }, bootMessage: null }, settings, new Date('2026-01-01T12:34:56Z'))
  const columnLitInTimer = x => Array.from({ length: 13 }, (_, y) => frame.pixels.subarray((y * 64 + x) * 3, (y * 64 + x + 1) * 3).some(value => value !== 0)).some(Boolean)
  assert.equal(columnLitInTimer(23), false, 'first colon needs a blank trailing column')
  assert.equal(columnLitInTimer(44), false, 'second colon needs a blank trailing column')
})

test('message lines are centered independently by bitmap width', () => {
  const configured = structuredClone(settings)
  configured.message = { visible: true, text: 'HI', color: '#ffffff' }
  const frame = renderDisplay({ timer: { mode: 'countdown', valueMs: 10_000, durationMs: 10_000 }, bootMessage: null }, configured)
  const columns = Array.from({ length: 64 }, (_, x) => x).filter(x => Array.from({ length: 7 }, (_, row) => {
    const offset = ((17 + row) * 64 + x) * 3
    return frame.pixels[offset] || frame.pixels[offset + 1] || frame.pixels[offset + 2]
  }).some(Boolean))
  assert.ok(Math.abs(columns[0] - (63 - columns.at(-1))) <= 1)
})

test('leading and trailing message spaces do not affect rendering or centering', () => {
  const clean = structuredClone(settings); clean.message = { visible: true, text: 'HI', color: '#ffffff' }
  const padded = structuredClone(settings); padded.message = { visible: true, text: '   HI   ', color: '#ffffff' }
  const state = { timer: { mode: 'countdown', valueMs: 10_000, durationMs: 10_000 }, bootMessage: null }
  assert.deepEqual(renderDisplay(state, padded).pixels, renderDisplay(state, clean).pixels)
})

test('single-line message is vertically centered across both lower slots when clock is hidden', () => {
  const configured = structuredClone(settings)
  configured.display.clockVisible = false
  configured.message = { visible: true, text: 'HI', color: '#ffffff' }
  const frame = renderDisplay({ timer: { mode: 'countdown', valueMs: 10_000, durationMs: 10_000 }, bootMessage: null }, configured)
  const rowLit = y => frame.pixels.subarray(y * 64 * 3, (y + 1) * 64 * 3).some(value => value !== 0)
  for (let y = 17; y <= 20; y += 1) assert.equal(rowLit(y), false)
  assert.equal(rowLit(21), true)
  assert.equal(rowLit(27), true)
  for (let y = 28; y <= 31; y += 1) assert.equal(rowLit(y), false)
})

test('expired countdown uses a full red bar and blinks it with the timer when enabled', () => {
  const configured = structuredClone(settings)
  configured.display.clockVisible = false
  configured.timer.blinkAtEnd = true
  const state = { timer: { mode: 'countdown', valueMs: 0, durationMs: 10_000 }, bootMessage: null }
  const visible = renderDisplay(state, configured, new Date(0))
  const hidden = renderDisplay(state, configured, new Date(500))
  const barPixel = (frame, x, y) => [...frame.pixels.subarray((y * 64 + x) * 3, (y * 64 + x + 1) * 3)]
  assert.deepEqual(barPixel(visible, 1, 14), [255, 0, 0])
  assert.deepEqual(barPixel(visible, 62, 15), [255, 0, 0])
  assert.deepEqual(barPixel(hidden, 1, 14), [0, 0, 0])
  assert.deepEqual(barPixel(hidden, 62, 15), [0, 0, 0])

  configured.timer.blinkAtEnd = false
  const steady = renderDisplay({ timer: { ...state.timer, valueMs: -1_000 }, bootMessage: null }, configured, new Date(500))
  assert.deepEqual(barPixel(steady, 1, 14), [255, 0, 0])
  assert.deepEqual(barPixel(steady, 62, 15), [255, 0, 0])
})

test('PNG encoder returns a valid PNG signature', () => {
  const frame = renderDisplay({ timer: { mode: 'countdown', valueMs: 0, durationMs: 1 }, bootMessage: null }, settings)
  assert.deepEqual([...encodePng(frame).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
})

test('PNG codec preserves framebuffer pixels', () => {
  const frame = renderDisplay({ timer: { mode: 'countdown', valueMs: 3000, durationMs: 5000 }, bootMessage: null }, settings)
  const decoded = decodePng(encodePng(frame))
  assert.equal(decoded.width, 64); assert.equal(decoded.height, 32); assert.deepEqual(decoded.pixels, frame.pixels)
})

test('archived 64x32 splash asset decodes for the hardware framebuffer', async () => {
  const splash = decodePng(await readFile(new URL('../assets/splash.png', import.meta.url)))
  assert.equal(splash.width, 64); assert.equal(splash.height, 32)
})
