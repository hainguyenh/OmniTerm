// Trace the OmniTerm logo PNG into a real (vector) SVG using potrace,
// and also write an embedded-PNG fallback SVG with comparable visual fidelity.
//
// Replaces the placeholder public/logo.svg and src/assets/logo.svg.
// Source-of-truth: public/OmniTerm-Logo-Original.png (1024x1024, 32bpp ARGB).
//
// Strategy:
//   1. sharp: scale source to 512x512, flatten alpha onto a transparent bg,
//      keep RGBA.
//   2. potrace: trace the binary alpha mask -> vector silhouette path,
//      filled with a dark color so it scales crisply at any size.
//   3. Also emit an embedded PNG variant (base64 inside <svg><image>),
//      for any consumer that wants the full raster fidelity (icons in-app).
//
// Usage:  node scripts/generate-logo-svg.mjs

import sharp from 'sharp'
import potrace from 'potrace'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const SRC = resolve(root, 'public/OmniTerm-Logo-Original.png')
const OUT_PUBLIC = resolve(root, 'public/logo.svg')
const OUT_ASSETS = resolve(root, 'src/assets/logo.svg')

// Snap a hex color to the dominant non-transparent color of the logo.
// From the histogram, the opaque logo pixels are dark (R/G/B ~ 16-30),
// trending toward a teal/navy. We use a single neutral dark fill that
// reads as the silhouette; consumers that need full color should import
// the PNG directly (per project convention via src/assets/appLogo.ts).
const TRACE_FILL = '#1f2937'

async function main() {
  const srcBuf = await readFile(SRC)

  // --- 1. Raster prep: 512x512 RGBA, re-encoded as PNG (potrace/Jimp needs an image format, not raw RGBA) ---
  const pngForTrace = await sharp(srcBuf)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const meta = await sharp(srcBuf).metadata()
  console.log(`[logo-svg] source: ${meta.width}x${meta.height} ${meta.channels}ch`)

  // --- 2. Potrace trace ---
  // potrace uses Jimp under the hood and accepts anything Jimp can read
  // (PNG/JPEG/BMP buffer or path). We feed the resized PNG buffer.
  const trace = await new Promise((resolveP, rejectP) => {
    potrace.trace(pngForTrace, { threshold: 128 }, (err, svg) => {
      if (err) return rejectP(err)
      resolveP(svg)
    })
  })

  // Extract just the <path d="..."> from potrace's full SVG output so we can
  // wrap it in our own layout with the proper viewBox + accessibility attrs.
  const pathMatch = trace.match(/<path[^>]*d="([^"]+)"/i)
  if (!pathMatch) {
    throw new Error('potrace: could not extract path d attribute from traced output')
  }
  const d = pathMatch[1]
  // potrace paths are usually expressed in pixel coordinates of the input
  // bitmap; we resized to 512, so normalize the viewBox to 512x512.
  const tracedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="OmniTerm logo">
  <path fill="${TRACE_FILL}" d="${d}"/>
</svg>
`
  await writeFile(OUT_PUBLIC, tracedSvg, 'utf8')
  console.log(`[logo-svg] traced vector -> ${OUT_PUBLIC} (${tracedSvg.length} bytes)`)

  // --- 3. Embedded-PNG variant for src/assets/logo.svg (full color fidelity) ---
  // Embed a 256x256 optimized PNG so the SVG stays small (~30-60 KB) while
  // rendering at full visual fidelity for in-app use (application chrome,
  // About dialog, etc.). This replaces the old "N monogram" placeholder.
  const pngBuf = await sharp(srcBuf)
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ quality: 90, compressionLevel: 9, palette: true })
    .toBuffer()
  const b64 = pngBuf.toString('base64')
  const embeddedSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="OmniTerm logo">
  <image x="0" y="0" width="256" height="256" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${b64}"/>
</svg>
`
  await writeFile(OUT_ASSETS, embeddedSvg, 'utf8')
  console.log(`[logo-svg] embedded-png -> ${OUT_ASSETS} (${embeddedSvg.length} bytes)`)
}

main().catch((err) => {
  console.error('[logo-svg] FAILED:', err)
  process.exit(1)
})
