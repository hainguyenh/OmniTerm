/**
 * The release version-drift guard.
 *
 * Five files each carry the version separately — package.json,
 * src-tauri/tauri.conf.json, src-tauri/Cargo.toml,
 * crates/app-core/Cargo.toml, and crates/app-protocol/Cargo.toml —
 * and the release workflow reads the tag from one of them while Tauri stamps
 * the installer from another. A drift ships an installer whose filename and
 * metadata disagree, and this script is the only thing that notices — so it
 * needs its own tests.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { DEFAULT_ROOT, currentVersions, validate, write } from '../sync-tauri-version.mjs'

const SCRIPT = path.join(DEFAULT_ROOT, 'scripts', 'sync-tauri-version.mjs')

const CARGO_CONTENT = (ver) => [
  '[package]',
  'name = "omniterm"',
  `version = "${ver}"`,
  '',
  '[dependencies]',
  '# Load-bearing comment a TOML round-trip would drop.',
  'tauri = { version = "2", features = ["protocol-asset"] }',
  'serde = "1"',
  'version = "9.9.9"',
  '',
].join('\n')

/** A throwaway repo carrying all 5 version-bearing files the script reads. */
async function fixture({
  pkg = '0.1.0',
  conf = '0.1.0',
  cargo = '0.1.0',
  crateCore = '0.1.0',
  crateProtocol = '0.1.0',
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omniterm-version-'))
  await mkdir(path.join(root, 'src-tauri'))
  await mkdir(path.join(root, 'crates', 'app-core'), { recursive: true })
  await mkdir(path.join(root, 'crates', 'app-protocol'), { recursive: true })

  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({ name: 'omniterm', version: pkg }, null, 2)}\n`)
  await writeFile(path.join(root, 'src-tauri', 'tauri.conf.json'), `${JSON.stringify({ productName: 'OmniTerm', version: conf }, null, 2)}\n`)
  await writeFile(path.join(root, 'src-tauri', 'Cargo.toml'), CARGO_CONTENT(cargo))
  await writeFile(path.join(root, 'crates', 'app-core', 'Cargo.toml'), CARGO_CONTENT(crateCore))
  await writeFile(path.join(root, 'crates', 'app-protocol', 'Cargo.toml'), CARGO_CONTENT(crateProtocol))
  return root
}

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })

test('validate accepts the real repository and names the version', () => {
  const result = run('validate')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /ok — every file is at \d+\.\d+\.\d+/)
})

test('validate rejects a release that does not match the checked-in version', () => {
  const result = run('validate', '9.9.9')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Requested release 9\.9\.9 but the repo is at/)
})

test('an unknown mode exits 2 so the workflow can tell misuse from a real drift', () => {
  const result = run('bump')
  assert.equal(result.status, 2)
  assert.match(result.stderr, /usage: sync-tauri-version\.mjs/)
})

test('validate reports every file when only one has drifted', async () => {
  // The exact failure the release job exists to catch: tauri.conf.json bumped, the others not.
  const root = await fixture({ conf: '0.1.1' })

  assert.throws(() => validate(undefined, root), (error) => {
    assert.match(error.message, /Version mismatch/)
    assert.match(error.message, /package\.json: 0\.1\.0/)
    assert.match(error.message, /tauri\.conf\.json: 0\.1\.1/)
    assert.match(error.message, /Cargo\.toml: 0\.1\.0/)
    return true
  })
})

test('validate rejects a prerelease even when all five files agree', async () => {
  // Tauri accepts `0.1.0-rc.1`; the workflow's tag resolver does not, so it must never get that far.
  const root = await fixture({
    pkg: '0.1.0-rc.1',
    conf: '0.1.0-rc.1',
    cargo: '0.1.0-rc.1',
    crateCore: '0.1.0-rc.1',
    crateProtocol: '0.1.0-rc.1',
  })
  assert.throws(() => validate(undefined, root), /is not a bare semver/)
})

test('currentVersions reads all 5 version files', async () => {
  const root = await fixture()
  assert.deepEqual(currentVersions(root), {
    'package.json': '0.1.0',
    'src-tauri/tauri.conf.json': '0.1.0',
    'src-tauri/Cargo.toml': '0.1.0',
    'crates/app-core/Cargo.toml': '0.1.0',
    'crates/app-protocol/Cargo.toml': '0.1.0',
  })
})

test('write updates all 5 files and preserves Cargo.toml comments', async () => {
  const root = await fixture()

  write('1.2.3', root)

  assert.deepEqual(currentVersions(root), {
    'package.json': '1.2.3',
    'src-tauri/tauri.conf.json': '1.2.3',
    'src-tauri/Cargo.toml': '1.2.3',
    'crates/app-core/Cargo.toml': '1.2.3',
    'crates/app-protocol/Cargo.toml': '1.2.3',
  })

  const cargo = await readFile(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8')
  assert.match(cargo, /# Load-bearing comment/)
  // The anchored regex must not reach a dependency's own version.
  assert.match(cargo, /tauri = \{ version = "2"/)
  assert.match(cargo, /^version = "9\.9\.9"$/m)
})

test('write refuses a partial version and leaves every file untouched', async () => {
  const root = await fixture()
  const before = await readFile(path.join(root, 'package.json'), 'utf8')

  assert.throws(() => write('1.2', root), /is not a bare semver/)

  assert.equal(await readFile(path.join(root, 'package.json'), 'utf8'), before)
  assert.deepEqual(currentVersions(root), {
    'package.json': '0.1.0',
    'src-tauri/tauri.conf.json': '0.1.0',
    'src-tauri/Cargo.toml': '0.1.0',
    'crates/app-core/Cargo.toml': '0.1.0',
    'crates/app-protocol/Cargo.toml': '0.1.0',
  })
})

test('importing the module does not run the CLI', () => {
  // The CLI is gated on being the entry point; without that gate every import above would have
  // exited the test process.
  assert.equal(typeof validate, 'function')
  assert.equal(fileURLToPath(new URL('../sync-tauri-version.mjs', import.meta.url)), SCRIPT)
})
