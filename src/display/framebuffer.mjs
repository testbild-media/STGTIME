import { deflateSync, inflateSync } from 'node:zlib'

export function parseColor(hex, fallback = [255, 255, 255]) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return fallback
  return [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16))
}

export class FrameBuffer {
  constructor(width = 64, height = 32) {
    this.width = width
    this.height = height
    this.pixels = Buffer.alloc(width * height * 3)
  }
  clear() { this.pixels.fill(0) }
  pixel(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const offset = (y * this.width + x) * 3
    this.pixels[offset] = color[0]
    this.pixels[offset + 1] = color[1]
    this.pixels[offset + 2] = color[2]
  }
  rect(x, y, width, height, color) {
    for (let yy = y; yy < y + height; yy += 1) for (let xx = x; xx < x + width; xx += 1) this.pixel(xx, yy, color)
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const name = Buffer.from(type)
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([size, name, data, crc])
}

export function encodePng(frame) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(frame.width, 0); ihdr.writeUInt32BE(frame.height, 4)
  ihdr[8] = 8; ihdr[9] = 2
  const rows = []
  for (let y = 0; y < frame.height; y += 1) rows.push(Buffer.from([0]), frame.pixels.subarray(y * frame.width * 3, (y + 1) * frame.width * 3))
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}

const paeth = (a, b, c) => {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid PNG')
  let offset = 8; let width; let height; let colorType; const compressed = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset); const type = buffer.toString('ascii', offset + 4, offset + 8); const data = buffer.subarray(offset + 8, offset + 8 + length); offset += length + 12
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); if (data[8] !== 8 || ![2, 6].includes(data[9])) throw new Error('Only 8-bit RGB/RGBA PNG is supported'); colorType = data[9] }
    if (type === 'IDAT') compressed.push(data)
    if (type === 'IEND') break
  }
  const channels = colorType === 6 ? 4 : 3; const stride = width * channels; const raw = inflateSync(Buffer.concat(compressed)); const decoded = Buffer.alloc(stride * height); let source = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source++]
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source++]; const left = x >= channels ? decoded[y * stride + x - channels] : 0; const up = y ? decoded[(y - 1) * stride + x] : 0; const upperLeft = y && x >= channels ? decoded[(y - 1) * stride + x - channels] : 0
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upperLeft) : (() => { throw new Error('Unknown PNG filter') })()
      decoded[y * stride + x] = (value + prediction) & 0xff
    }
  }
  const frame = new FrameBuffer(width, height)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const alpha = channels === 4 ? decoded[pixel * channels + 3] / 255 : 1
    for (let channel = 0; channel < 3; channel += 1) frame.pixels[pixel * 3 + channel] = Math.round(decoded[pixel * channels + channel] * alpha)
  }
  return frame
}
