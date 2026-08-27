// 앱 아이콘(PNG) 만들기 - 외부 라이브러리 없이 픽셀을 직접 그려서 저장한다.
//   node scripts/make-icons.mjs
// 나중에 다른 그림으로 바꾸고 싶으면 public/icons/*.png 를 직접 교체해도 됩니다.

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'public', 'icons')

const BRAND = [29, 78, 216]   // #1d4ed8
const PAPER = [255, 255, 255]
const BAND = [192, 39, 28]    // 달력 위쪽 빨간 띠
const RING = [214, 218, 225]

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** rgba 픽셀 배열(Uint8Array, size*size*4)을 PNG 파일로 */
function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8    // bit depth
  ihdr[9] = 6    // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    pixels.copy
      ? pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
      : raw.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4)
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255
  }

  // 배경 (모서리를 살짝 둥글게)
  const radius = size * 0.18
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(radius - x, 0, x - (size - radius - 1))
      const dy = Math.max(radius - y, 0, y - (size - radius - 1))
      if (dx * dx + dy * dy <= radius * radius) set(x, y, BRAND)
    }
  }

  // 달력 몸통
  const m = Math.round(size * 0.2)
  const top = Math.round(size * 0.26)
  const bottom = size - m
  for (let y = top; y < bottom; y++) {
    for (let x = m; x < size - m; x++) set(x, y, PAPER)
  }

  // 위쪽 빨간 띠
  const bandEnd = top + Math.round(size * 0.1)
  for (let y = top; y < bandEnd; y++) {
    for (let x = m; x < size - m; x++) set(x, y, BAND)
  }

  // 고리 두 개
  const ringW = Math.round(size * 0.055)
  const ringTop = Math.round(size * 0.16)
  for (const cx of [m + Math.round(size * 0.12), size - m - Math.round(size * 0.12) - ringW]) {
    for (let y = ringTop; y < top + Math.round(size * 0.03); y++) {
      for (let x = cx; x < cx + ringW; x++) set(x, y, RING)
    }
  }

  // 날짜 칸 3 x 3
  const gridTop = bandEnd + Math.round(size * 0.055)
  const cell = Math.round(size * 0.085)
  const gap = Math.round(size * 0.038)
  const startX = m + Math.round(size * 0.06)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const x0 = startX + c * (cell + gap)
      const y0 = gridTop + r * (cell + gap)
      if (y0 + cell >= bottom - Math.round(size * 0.03)) continue
      const color = r === 1 && c === 1 ? BRAND : RING
      for (let y = y0; y < y0 + cell; y++) {
        for (let x = x0; x < x0 + cell; x++) set(x, y, color)
      }
    }
  }

  return encodePng(size, px)
}

mkdirSync(outDir, { recursive: true })
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(join(outDir, name), drawIcon(size))
  console.log(`만들었습니다: public/icons/${name} (${size}x${size})`)
}
