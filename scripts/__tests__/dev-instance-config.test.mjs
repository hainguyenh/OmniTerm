import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..', '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const devConfig = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.dev.conf.json'), 'utf8'))
const viteConfig = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8')

test('development Tauri commands use an isolated application identifier', () => {
  assert.equal(devConfig.identifier, 'com.omniterm.dev')
  assert.notEqual(devConfig.identifier, 'com.omniterm.app')
  for (const scriptName of ['tauri:dev:basic', 'tauri:dev:full', 'tauri:dev:limited']) {
    assert.match(packageJson.scripts[scriptName], /--config src-tauri\/tauri\.dev\.conf\.json/)
  }
})

test('Vite dev watcher ignores patch artifacts', () => {
  assert.match(viteConfig, /watch:\s*\{[\s\S]*ignored:\s*\[[^\]]*['"]\*\*\/\*\.patch['"]/m)
})

test('Vite dev watcher ignores cargo target artifacts so EBUSY does not crash HMR', () => {
  // The `**/target/**` glob is silently dropped by anymatch in Vite 8's bundled
  // chokidar on Windows absolute paths; the exclude for cargo's target tree is a
  // function (`isCargoTarget`) so anymatch preserves it verbatim.
  assert.match(viteConfig, /watch:\s*\{[\s\S]*ignored:\s*\[[^\]]*isCargoTarget/m)
})
