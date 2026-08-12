import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..', '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const devConfig = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.dev.conf.json'), 'utf8'))

test('development Tauri commands use an isolated application identifier', () => {
  assert.equal(devConfig.identifier, 'com.omniterm.dev')
  assert.notEqual(devConfig.identifier, 'com.omniterm.app')
  for (const scriptName of ['tauri:dev:basic', 'tauri:dev:full', 'tauri:dev:limited']) {
    assert.match(packageJson.scripts[scriptName], /--config src-tauri\/tauri\.dev\.conf\.json/)
  }
})
