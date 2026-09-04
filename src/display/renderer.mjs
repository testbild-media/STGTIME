import { FrameBuffer, parseColor } from './framebuffer.mjs'
import { drawClockText, drawMainTime, drawText, drawTinyText, mainTimeWidth, textWidth } from './font.mjs'

const pad = value => String(Math.abs(value)).padStart(2, '0')
const clockFormatters = new Map()

function getClockFormatter(timeZone) {
  if (!clockFormatters.has(timeZone)) {
    clockFormatters.set(timeZone, new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }))
  }
  return clockFormatters.get(timeZone)
}

export function formatClockTime(now, timeZone = 'UTC') {
  let formatter
  try { formatter = getClockFormatter(timeZone) } catch { formatter = getClockFormatter('UTC') }
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]))
  return `${parts.hour}:${parts.minute}:${parts.second}`
}

export function formatDuration(ms, format = 'HH:MM:SS') {
  const negative = ms < 0
  const seconds = Math.floor(Math.abs(ms) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = format === 'MM:SS' ? Math.floor(seconds / 60) : Math.floor((seconds % 3600) / 60)
  const result = format === 'MM:SS' ? `${pad(minutes)}:${pad(seconds % 60)}` : `${pad(hours)}:${pad(minutes)}:${pad(seconds % 60)}`
  return negative ? `-${result}` : result
}

export function formatMainTime(ms, format = 'HH:MM:SS') {
  return ms < 0 ? formatDuration(ms, 'MM:SS') : formatDuration(ms, format)
}

function thresholdColor(timer, settings) {
  const colors = settings.timer.colors
  if (timer.mode === 'stopwatch') return parseColor(colors.normal)
  if (timer.valueMs <= settings.timer.thresholdsMs.critical) return parseColor(colors.critical)
  if (timer.valueMs <= settings.timer.thresholdsMs.warning) return parseColor(colors.warning)
  return parseColor(colors.normal)
}

function progress(frame, timer, settings) {
  if (timer.mode !== 'countdown' || timer.durationMs <= 0) return
  const normal = parseColor(settings.timer.colors.normal)
  const warning = parseColor(settings.timer.colors.warning)
  const critical = parseColor(settings.timer.colors.critical)
  if (timer.valueMs <= 0) {
    frame.rect(1, 14, 62, 2, critical)
    return
  }
  const width = Math.max(0, Math.min(62, Math.round(timer.valueMs / timer.durationMs * 62)))
  for (let x = 0; x < width; x += 1) {
    const remainingAtX = timer.durationMs * (x + 1) / 62
    const color = remainingAtX <= settings.timer.thresholdsMs.critical ? critical : remainingAtX <= settings.timer.thresholdsMs.warning ? warning : normal
    frame.rect(1 + x, 14, 1, 2, color)
  }
}

function clipText(text, maxWidth = 62) {
  let result = ''
  for (const char of text) {
    if (textWidth(result + char) > maxWidth) break
    result += char
  }
  return result.trimEnd()
}

function messageLines(message) {
  if (textWidth(message) <= 62) return [message]
  const maximumPrefix = clipText(message)
  const space = maximumPrefix.lastIndexOf(' ')
  const first = space > 0 ? maximumPrefix.slice(0, space) : maximumPrefix
  const remainder = message.slice(space > 0 ? space + 1 : first.length).trimStart()
  return [first, clipText(remainder)]
}

function drawCenteredText(frame, text, y, color) {
  const width = textWidth(text)
  drawText(frame, text, Math.max(1, Math.floor((64 - width) / 2)), y, color, { maxWidth: 62 })
}

export function renderDisplay(state, settings, now = new Date()) {
  const frame = new FrameBuffer(64, 32)
  if (state.bootMessage) {
    drawText(frame, 'STGTIME', 17, 3, [0, 255, 72])
    drawText(frame, 'OPEN', 1, 15, [255, 208, 0])
    drawText(frame, state.bootMessage, 1, 24, [255, 255, 255], { maxWidth: 63 })
    return frame
  }
  const color = thresholdColor(state.timer, settings)
  const shouldBlink = settings.timer.blinkAtEnd && state.timer.mode === 'countdown' && state.timer.valueMs <= 0
  const timerVisible = !shouldBlink || Math.floor(now.getTime() / 500) % 2 === 0
  if (timerVisible) {
    const time = formatMainTime(state.timer.valueMs, settings.display.format)
    const width = mainTimeWidth(time)
    drawMainTime(frame, time, Math.max(0, Math.floor((64 - width) / 2)), 0, color)
    progress(frame, state.timer, settings)
  }

  if (settings.message.visible && settings.message.text) {
    const message = settings.message.text.trim().toUpperCase()
    const color = parseColor(settings.message.color)
    const lines = messageLines(message)
    const firstLineY = lines.length === 1 && !settings.display.clockVisible ? 21 : 17
    drawCenteredText(frame, lines[0], firstLineY, color)
    if (lines.length > 1) {
      drawCenteredText(frame, lines[1], 25, color)
      return frame
    }
  } else if (settings.video.visible) {
    const videoWidth = settings.video.durationMs > 0 ? Math.max(0, Math.min(19, Math.round(settings.video.remainingMs / settings.video.durationMs * 19))) : 0
    frame.rect(1, 17, videoWidth, 1, parseColor(settings.video.color))
    drawTinyText(frame, settings.video.label || 'VIDEO', 1, 19, parseColor(settings.video.color), { maxWidth: 20 })
    drawClockText(frame, formatDuration(settings.video.remainingMs, 'HH:MM:SS'), 24, 17, parseColor(settings.video.color), { maxWidth: 40 })
  }
  if (settings.display.clockVisible) {
    const clock = formatClockTime(now, settings.display.timeZone)
    drawTinyText(frame, 'TIME', 1, 26, parseColor(settings.display.clockColor), { maxWidth: 20 })
    drawClockText(frame, clock, 24, 25, parseColor(settings.display.clockColor), { maxWidth: 40 })
  }
  return frame
}
