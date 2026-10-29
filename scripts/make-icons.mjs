/**
 * Generates the app icons as PNGs with no native dependencies — a rounded
 * tile with the ZakTracks five-leaf clover mark in beige.
 *
 *   node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'icons')

// ---------------------------------------------------------------- PNG codec

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

const crc32 = (buf) => {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ------------------------------------------------------------------- drawing

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a, b, t) => a + (b - a) * t

/** Squircle-ish rounded rectangle distance check in normalized coordinates. */
const inRoundedRect = (x, y, r) => {
  const dx = Math.abs(x - 0.5)
  const dy = Math.abs(y - 0.5)
  const kx = Math.max(0, dx - (0.5 - r))
  const ky = Math.max(0, dy - (0.5 - r))
  return Math.hypot(kx, ky) <= r
}

/** Point-in-triangle test (any winding). */
const inTri = (x, y, ax, ay, bx, by, cx, cy) => {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by)
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy)
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

function drawIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4)
  const scale = maskable ? 0.72 : 1 // keep art inside the maskable safe zone
  const corner = maskable ? 0 : 0.225

  // Five-leaf clover: each leaf = two round lobes + a tapering wedge (a
  // heart-shaped leaflet pointing outward), matching the inline SVG mark.
  // Geometry is authored in the 64-unit viewBox, leaf pointing up.
  const U = (v) => (v / 64) * scale // viewBox units → normalized, maskable-safe
  const lobeA = [-U(6), U(20.5)] // lobe centres either side of the leaf spine
  const lobeB = [U(6), U(20.5)]
  const lobeR = U(5.6)
  const apex = [0, -U(1.5)] // wedge apex just below the centre
  const wedgeL = [-U(10.5), U(20.5)]
  const wedgeR = [U(10.5), U(20.5)]
  const centerR = U(3.6) // dot joining the leaf tips
  const angles = [0, 1, 2, 3, 4].map((k) => (k * 2 * Math.PI) / 5) // 0 = up

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size
      const y = (py + 0.5) / size
      const i = (py * size + px) * 4

      const inside = corner === 0 ? true : inRoundedRect(x, y, corner)
      if (!inside) {
        rgba[i + 3] = 0
        continue
      }

      // Background: vertical espresso-brown gradient
      const g = clamp01((y - 0.05) / 0.9)
      let r = mix(0x2a, 0x14, g)
      let gr = mix(0x1d, 0x0c, g)
      let b = mix(0x14, 0x08, g)

      // Soft top-left glow, very subtle
      const glow = clamp01(1 - Math.hypot(x - 0.28, y - 0.2) / 0.9)
      r += 8 * glow
      gr += 6 * glow
      b += 4 * glow

      // Paint the pixel if it lands inside the centre dot or any leaf
      const dx = x - 0.5
      const dy = y - 0.5
      const rad = Math.hypot(dx, dy)
      let clover = rad <= centerR
      if (!clover) {
        const upAngle = Math.atan2(dx, -dy) // 0 = straight up
        for (const a of angles) {
          const delta = upAngle - a
          const lx = rad * Math.sin(delta)
          const ly = rad * Math.cos(delta)
          const lobe =
            Math.hypot(lx - lobeA[0], ly - lobeA[1]) <= lobeR ||
            Math.hypot(lx - lobeB[0], ly - lobeB[1]) <= lobeR
          const wedge = inTri(
            lx,
            ly,
            apex[0],
            apex[1],
            wedgeR[0],
            wedgeR[1],
            wedgeL[0],
            wedgeL[1],
          )
          if (lobe || wedge) {
            clover = true
            break
          }
        }
      }
      if (clover) {
        r = 0xf2
        gr = 0xec
        b = 0xdf
      }

      rgba[i] = Math.max(0, Math.min(255, Math.round(r)))
      rgba[i + 1] = Math.max(0, Math.min(255, Math.round(gr)))
      rgba[i + 2] = Math.max(0, Math.min(255, Math.round(b)))
      rgba[i + 3] = 255
    }
  }
  return encodePng(size, size, rgba)
}

// --------------------------------------------------------------------- write

mkdirSync(OUT, { recursive: true })
const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-180.png', 180, { maskable: true }],
  ['icon-maskable-512.png', 512, { maskable: true }],
]
for (const [name, size, opts] of targets) {
  writeFileSync(join(OUT, name), drawIcon(size, opts))
  console.log(`wrote public/icons/${name} (${size}x${size})`)
}
