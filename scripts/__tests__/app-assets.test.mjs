import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
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
      if (relative === 'ui/generated' || relative.startsWith('ui/generated/') || relative === 'src-tauri/icons' || relative.startsWith('src-tauri/icons/')) {
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
