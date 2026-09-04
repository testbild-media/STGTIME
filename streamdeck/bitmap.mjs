import { GLYPHS } from '../src/display/font.mjs'

function rgb(hex) {
  const value = Number.parseInt(String(hex).replace('#', ''), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function rect(buffer, width, height, x, y, rectWidth, rectHeight, color) {
  const [r, g, b] = rgb(color)
  const left = Math.max(0, Math.floor(x))
  const top = Math.max(0, Math.floor(y))
  const right = Math.min(width, Math.ceil(x + rectWidth))
  const bottom = Math.min(height, Math.ceil(y + rectHeight))
  for (let yy = top; yy < bottom; yy += 1) {
    for (let xx = left; xx < right; xx += 1) {
      const offset = (yy * width + xx) * 4
      buffer[offset] = r
      buffer[offset + 1] = g
      buffer[offset + 2] = b
      buffer[offset + 3] = 255
    }
  }
}

function naturalWidth(text) {
  return [...text].reduce((total, character, index) => total + (GLYPHS[character]?.[0].length || 3) + (index ? 1 : 0), 0)
}

function drawText(buffer, width, height, text, centerY, maxWidth, maxHeight, color) {
  const normalized = String(text).toUpperCase()
  const scale = Math.max(1, Math.floor(Math.min(maxWidth / naturalWidth(normalized), maxHeight / 7)))
  const renderedWidth = naturalWidth(normalized) * scale
  let cursor = Math.floor((width - renderedWidth) / 2)
  const top = Math.floor(centerY - 3.5 * scale)
  for (const character of normalized) {
    const glyph = GLYPHS[character] || GLYPHS['?']
    glyph.forEach((row, yy) => [...row].forEach((bit, xx) => {
      if (bit === '1') rect(buffer, width, height, cursor + xx * scale, top + yy * scale, scale, scale, color)
    }))
    cursor += (glyph[0].length + 1) * scale
  }
}

function splitLabel(label) {
  const words = String(label).trim().split(/\s+/).filter(Boolean)
  if (words.length <= 2) return words
  const middle = Math.ceil(words.length / 2)
  return [words.slice(0, middle).join(' '), words.slice(middle).join(' ')]
}

export function createKeyImage(width, height, { label = '', value = '', background = '#12161a', foreground = '#ffffff', accent = '#ff6900' } = {}) {
  const buffer = new Uint8Array(width * height * 4)
  rect(buffer, width, height, 0, 0, width, height, background)
  rect(buffer, width, height, 0, 0, width, Math.max(4, Math.round(height * 0.08)), accent)
  if (value) {
    drawText(buffer, width, height, value, height * 0.43, width * 0.88, height * 0.38, foreground)
    drawText(buffer, width, height, label, height * 0.79, width * 0.88, height * 0.15, '#d5dbe0')
  } else {
    const lines = splitLabel(label).slice(0, 2)
    const lineHeight = height * 0.25
    const firstCenter = height * (lines.length > 1 ? 0.43 : 0.54)
    lines.forEach((line, index) => drawText(buffer, width, height, line, firstCenter + index * lineHeight, width * 0.86, height * 0.20, foreground))
  }
  return buffer
}
