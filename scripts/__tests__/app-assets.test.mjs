import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { encodeBmp24 } from '../image/bmp.mjs'
import { encodeIco } from '../image/ico.mjs'

const root = process.cwd()

const IGNORED_DIR_NAMES = new Set([
  '.git', 'node_modules', '.pnpm', 'plugins', 'dist', 'target', 'coverage', 'coverage-js', 'coverage-rust',
])

async function repositoryImageFiles() {
  const out = []
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (IGNORED_DIR_NAMES.has(entry.name)) continue
      const full = path.join(current, entry.name)
      const relative = path.relative(root, full).replaceAll('\\', '/')
      if (relative === 'ui/generated' || relative.startsWith('ui/generated/') || relative === 'src-tauri/icons' || relative.startsWith('src-tauri/icons/') || relative === 'assets/loading' || relative.startsWith('assets/loading/') || relative === 'assets/demo-pics' || relative.startsWith('assets/demo-pics/')) {
        continue
      }
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && /\.(?:png|jpe?g|webp|gif|svg|ico|icns)$/i.test(entry.name)) {
        out.push(relative)
      }
    }
  }
  await walk(root)
  return out.sort()
}

test('encodeIco writes valid directory entries and PNG offsets', () => {
  const first = Buffer.from('first-png')
  const second = Buffer.from('second-png')
  const ico = encodeIco([
    { width: 16, height: 16, data: first },
    { width: 256, height: 256, data: second },
  ])

  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 2)
  assert.equal(ico.readUInt8(6), 16)
  assert.equal(ico.readUInt8(22), 0, '256px is encoded as zero in ICO directory')
  assert.equal(ico.readUInt32LE(14), first.length)
  assert.equal(ico.readUInt32LE(18), 38)
  assert.equal(ico.readUInt32LE(30), second.length)
  assert.equal(ico.readUInt32LE(34), 38 + first.length)
  assert.deepEqual(ico.subarray(38, 38 + first.length), first)
  assert.deepEqual(ico.subarray(38 + first.length), second)
})

test('encodeIco rejects malformed image lists', () => {
  assert.throws(() => encodeIco([]), /at least one/)
  assert.throws(() => encodeIco([{ width: 0, height: 16, data: Buffer.of(1) }]), /width/)
  assert.throws(() => encodeIco([{ width: 16, height: 257, data: Buffer.of(1) }]), /height/)
  assert.throws(() => encodeIco([{ width: 16, height: 16, data: Buffer.alloc(0) }]), /cannot be empty/)
})

test('encodeBmp24 writes valid 24-bit Windows BMP header and BGR rows with padding', () => {
  const width = 2
  const height = 2
  // 2x2 RGB: top row [red, green], bottom row [blue, white]
  const data = Buffer.from([
    255, 0, 0,    0, 255, 0,
    0, 0, 255,    255, 255, 255,
  ])
  const bmp = encodeBmp24({ width, height, data })

  assert.equal(bmp.subarray(0, 2).toString('ascii'), 'BM')
  assert.equal(bmp.readUInt32LE(10), 54, 'Pixel data offset is 54')
  assert.equal(bmp.readUInt32LE(14), 40, 'BITMAPINFOHEADER size is 40')
  assert.equal(bmp.readInt32LE(18), 2, 'Width is 2')
  assert.equal(bmp.readInt32LE(22), 2, 'Height is 2')
  assert.equal(bmp.readUInt16LE(26), 1, 'Color planes is 1')
  assert.equal(bmp.readUInt16LE(28), 24, 'Bits per pixel is 24')
  assert.equal(bmp.readUInt32LE(30), 0, 'Compression is BI_RGB (uncompressed)')

  // Row size for width 2: 2 * 3 = 6 bytes + 2 bytes padding = 8 bytes per row
  assert.equal(bmp.readUInt32LE(2), 54 + 8 * 2, 'File size matches header + padded pixel data')

  // First row in BMP data is bottom row: blue (BGR: 255, 0, 0), white (BGR: 255, 255, 255)
  assert.deepEqual(bmp.subarray(54, 57), Buffer.from([255, 0, 0]), 'Bottom-left pixel is blue in BGR')
  assert.deepEqual(bmp.subarray(57, 60), Buffer.from([255, 255, 255]), 'Bottom-right pixel is white in BGR')
  assert.deepEqual(bmp.subarray(60, 62), Buffer.from([0, 0]), 'Row 1 has 2 padding bytes')

  // Second row in BMP data is top row: red (BGR: 0, 0, 255), green (BGR: 0, 255, 0)
  assert.deepEqual(bmp.subarray(62, 65), Buffer.from([0, 0, 255]), 'Top-left pixel is red in BGR')
  assert.deepEqual(bmp.subarray(65, 68), Buffer.from([0, 255, 0]), 'Top-right pixel is green in BGR')
  assert.deepEqual(bmp.subarray(68, 70), Buffer.from([0, 0]), 'Row 2 has 2 padding bytes')
})

test('encodeBmp24 rejects invalid dimensions or mismatched data', () => {
  assert.throws(() => encodeBmp24({ width: 0, height: 10, data: Buffer.alloc(0) }), /width/)
  assert.throws(() => encodeBmp24({ width: 10, height: 0, data: Buffer.alloc(0) }), /height/)
  assert.throws(() => encodeBmp24({ width: 2, height: 2, data: Buffer.alloc(11) }), /length must be/)
})

test('repository keeps one original logo and generates every derivative', async () => {
  const images = await repositoryImageFiles()
  assert.deepEqual(images, ['assets/OmniTerm-Logo-Original.png'])

  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  assert.equal(packageJson.scripts['assets:generate'], 'node scripts/generate-app-assets.mjs')
  for (const script of ['dev', 'build:frontend', 'typecheck', 'lint', 'test', 'coverage:js']) {
    assert.match(packageJson.scripts[script], /assets:generate/, `${script} must generate assets first`)
  }

  const appLogo = await readFile(path.join(root, 'ui/assets/appLogo.ts'), 'utf8')
  assert.match(appLogo, /generated\/OmniTerm-Logo\.webp/)
  const html = await readFile(path.join(root, 'index.html'), 'utf8')
  assert.match(html, /ui\/generated\/OmniTerm-Logo\.webp/)
  const tauri = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
  assert.deepEqual(tauri.bundle.icon, [
    'icons/32x32.png',
    'icons/128x128.png',
    'icons/128x128@2x.png',
    'icons/icon.ico',
    'icons/icon.png',
  ])
})
