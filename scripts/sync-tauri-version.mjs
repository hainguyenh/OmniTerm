/**
 * Keep the three places a release version is written in agreement.
 *
 *   node scripts/sync-tauri-version.mjs validate [expected]
 *   node scripts/sync-tauri-version.mjs write <version>
 *
 * `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` each carry the version
 * independently. Tauri stamps the installer from tauri.conf.json, while the release workflow resolves
 * the tag from package.json — so a drift between them ships an installer whose name and its metadata
 * disagree, and nothing else in the build notices.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.join(root, 'package.json')
const CONF = path.join(root, 'src-tauri', 'tauri.conf.json')
const CARGO = path.join(root, 'src-tauri', 'Cargo.toml')

const SEMVER = /^\d+\.\d+\.\d+$/
/** Only the `version` on the first `[package]` key — a dependency's `version = "…"` must not match. */
const CARGO_VERSION = /^version\s*=\s*"([^"]+)"/m

const read = (file) => readFileSync(file, 'utf8')

function currentVersions() {
  const cargo = read(CARGO).match(CARGO_VERSION)
  if (!cargo) throw new Error('Could not find a version in src-tauri/Cargo.toml')
  return {
    'package.json': JSON.parse(read(PKG)).version,
    'src-tauri/tauri.conf.json': JSON.parse(read(CONF)).version,
    'src-tauri/Cargo.toml': cargo[1],
  }
}

function validate(expected) {
  const versions = currentVersions()
  const distinct = [...new Set(Object.values(versions))]
  if (distinct.length !== 1) {
    const detail = Object.entries(versions)
      .map(([file, v]) => `  ${file}: ${v}`)
      .join('\n')
    throw new Error(`Version mismatch across release metadata:\n${detail}`)
  }
  const [version] = distinct
  if (!SEMVER.test(version)) {
    throw new Error(`Version "${version}" is not a bare semver (X.Y.Z).`)
  }
  if (expected && expected !== version) {
    throw new Error(`Requested release ${expected} but the repo is at ${version}.`)
  }
  console.log(`[sync-tauri-version] ok — every file is at ${version}`)
}

function write(version) {
  if (!SEMVER.test(version)) {
    throw new Error(`Version "${version}" is not a bare semver (X.Y.Z).`)
  }
  const pkg = JSON.parse(read(PKG))
  pkg.version = version
  writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`)

  const conf = JSON.parse(read(CONF))
  conf.version = version
  writeFileSync(CONF, `${JSON.stringify(conf, null, 2)}\n`)

  // Rewritten as text, not parsed: Cargo.toml carries comments the build relies on for context, and
  // a TOML round-trip would drop them.
  writeFileSync(CARGO, read(CARGO).replace(CARGO_VERSION, `version = "${version}"`))
  console.log(`[sync-tauri-version] wrote ${version} to all three files`)
}

const [mode, arg] = process.argv.slice(2)
try {
  if (mode === 'validate') validate(arg)
  else if (mode === 'write') write(arg)
  else {
    console.error('usage: sync-tauri-version.mjs <validate [expected] | write <version>>')
    process.exit(2)
  }
} catch (err) {
  console.error(`[sync-tauri-version] ${err.message}`)
  process.exit(1)
}
