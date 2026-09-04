import test from 'node:test'
import assert from 'node:assert/strict'
import { FrameBuffer } from '../src/display/framebuffer.mjs'
import { drawMainTime, drawText, textWidth } from '../src/display/font.mjs'

test('7px N is four pixels wide with a visible diagonal', () => {
  const frame = new FrameBuffer(4, 7)
  drawText(frame, 'N', 0, 0, [255, 255, 255])
  const lit = (x, y) => frame.pixels[(y * 4 + x) * 3] !== 0
  assert.equal(textWidth('N'), 4)
  assert.equal(lit(1, 0), false)
  assert.equal(lit(1, 1), true)
  assert.equal(lit(1, 3), false)
  assert.equal(lit(2, 3), true)
  assert.equal(lit(2, 6), false)
})

test('13px minus sign is shifted down by one pixel', () => {
  const frame = new FrameBuffer(10, 13)
  drawMainTime(frame, '-', 0, 0, [255, 255, 255])
  const rowLit = y => frame.pixels.subarray(y * 10 * 3, (y + 1) * 10 * 3).some(value => value !== 0)
  assert.equal(rowLit(5), false)
  assert.equal(rowLit(6), true)
  assert.equal(rowLit(7), true)
  assert.equal(rowLit(8), false)
})

test('7px font contains a centered plus glyph for Stream Deck adjustments', () => {
  const frame = new FrameBuffer(3, 7)
  drawText(frame, '+', 0, 0, [255, 255, 255])
  const lit = (x, y) => frame.pixels[(y * 3 + x) * 3] !== 0
  assert.equal(textWidth('+'), 3)
  assert.equal(lit(1, 1), true)
  assert.equal(lit(0, 3), true)
  assert.equal(lit(2, 3), true)
})
