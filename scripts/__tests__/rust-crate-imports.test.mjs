import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const protocolManifestPath = new URL('../../crates/app-protocol/Cargo.toml', import.meta.url)
const workspaceRustFiles = [
  '../../crates/app-core/src/workspace_model.rs',
  '../../crates/app-core/src/workspace_model_tests.rs',
  '../../src-tauri/src/workspace.rs',
  '../../src-tauri/src/workspace_persistence.rs',
]

function declaredLibraryName(manifest) {
  const libSection = manifest.match(/\[lib\]([\s\S]*?)(?:\n\[|$)/)
  assert.ok(libSection, 'app-protocol Cargo.toml must declare a [lib] section')
  const name = libSection[1].match(/^name\s*=\s*"([^"]+)"/m)?.[1]
  assert.ok(name, 'app-protocol [lib] must declare a crate name')
  return name
}

test('workspace Rust modules import the protocol crate by its declared library name', async () => {
  const manifest = await readFile(protocolManifestPath, 'utf8')
  const crateName = declaredLibraryName(manifest)
  assert.equal(crateName, 'app_protocol')

  for (const relativePath of workspaceRustFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
    assert.doesNotMatch(
      source,
      /\bomniterm_protocol::/,
      `${relativePath} must use the protocol library crate name (${crateName}), not the Cargo package name`,
    )
  }
})

test('native crates used by packaged Tauri modules remain runtime dependencies', async () => {
  const manifest = await readFile(new URL('../../src-tauri/Cargo.toml', import.meta.url), 'utf8')
  const runtimeDependencies = manifest.match(/\[dependencies\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? ''
  const devDependencies = manifest.match(/\[dev-dependencies\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? ''
  const alwaysAwake = await readFile(
    new URL('../../plugins/always-awake/native/always_awake.rs', import.meta.url),
    'utf8',
  )

  assert.match(alwaysAwake, /\buse sysinfo::System;/)
  assert.match(runtimeDependencies, /^sysinfo\s*=/m, 'sysinfo is used by packaged Always Awake code')
  assert.doesNotMatch(devDependencies, /^sysinfo\s*=/m, 'runtime sysinfo must not be dev-only')
})
