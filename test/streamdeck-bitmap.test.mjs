import test from 'node:test'
import assert from 'node:assert/strict'
import { createKeyImage } from '../streamdeck/bitmap.mjs'

test('Stream Deck keys use an exact plain RGBA Uint8Array', () => {
  const image = createKeyImage(72, 72, { label: 'SET TIME', value: '05' })
  assert.equal(image.constructor, Uint8Array)
  assert.equal(image.length, 72 * 72 * 4)
  assert.ok(image.some((value, index) => index % 4 !== 3 && value > 0))
  for (let index = 3; index < image.length; index += 4) assert.equal(image[index], 255)
})
