import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { findNoopTauriCommands, findOrphanModules, findOrphanRustModules, findUnreferencedTauriCommands } from '../check-dead-code.mjs'

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniterm-dead-code-'))
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return root
}

test('findOrphanModules follows static, re-export, dynamic, and index imports', () => {
  const root = fixture({
    'src/main.tsx': "import './feature'; export { value } from './shared'",
    'src/feature/index.ts': "void import('../lazy')",
    'src/lazy.ts': 'export const lazy = true',
    'src/shared.ts': 'export const value = 1',
  })
  try {
    assert.deepEqual(findOrphanModules({ root, sourceRoots: ['src'], entrypoints: ['src/main.tsx'] }), [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('findOrphanModules reports production files with no importer', () => {
  const root = fixture({
    'src/main.tsx': "import './used'",
    'src/used.ts': 'export const used = true',
    'src/dead.tsx': 'export default function Dead() { return null }',
    'src/ignored.test.ts': "import './dead'",
  })
  try {
    assert.deepEqual(
      findOrphanModules({ root, sourceRoots: ['src'], entrypoints: ['src/main.tsx'] }),
      ['src/dead.tsx'],
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('findNoopTauriCommands reports registered commands whose body only returns a constant', () => {
  const root = fixture({
    'src-tauri/src/lib.rs': `
      #[tauri::command]
      async fn empty_unit() -> Result<(), String> { Ok(()) }

      #[tauri::command]
      async fn empty_bool() -> Result<bool, String> {
        // A comment must not make this command meaningful.
        Ok(true)
      }

      #[tauri::command]
      async fn empty_json() -> Result<serde_json::Value, String> {
        Ok(serde_json::json!(null))
      }

      #[tauri::command]
      async fn meaningful(value: bool) -> Result<bool, String> {
        audit(value);
        Ok(value)
      }

      fn helper() -> Result<(), String> { Ok(()) }
    `,
  })
  try {
    assert.deepEqual(findNoopTauriCommands({ root, sourceRoots: ['src-tauri/src'] }), [
      'src-tauri/src/lib.rs:empty_bool',
      'src-tauri/src/lib.rs:empty_json',
      'src-tauri/src/lib.rs:empty_unit',
    ])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('findNoopTauriCommands accepts commands with real validation or side effects', () => {
  const root = fixture({
    'src-tauri/src/commands.rs': `
      #[tauri::command]
      pub async fn validate(value: bool) -> Result<bool, String> {
        if !value { return Ok(false); }
        persist(value)?;
        Ok(true)
      }
    `,
  })
  try {
    assert.deepEqual(findNoopTauriCommands({ root, sourceRoots: ['src-tauri/src'] }), [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('findUnreferencedTauriCommands reports handlers the production bridge never invokes', () => {
  const root = fixture({
    'src-tauri/src/lib.rs': `
      fn run() {
        tauri::Builder::default().invoke_handler(tauri::generate_handler![
          commands::used,
          commands::dead,
        ]);
      }
    `,
    'ui/bridge.ts': `
      import { invoke } from '@tauri-apps/api/core'
      export const run = () => invoke<Array<{ id: string }>>('used')
    `,
    'ui/bridge.test.ts': `invoke('dead')`,
  })
  try {
    assert.deepEqual(findUnreferencedTauriCommands({ root }), ['src-tauri/src/lib.rs:dead'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('findOrphanRustModules reports production files outside the Rust module graph', () => {
  const root = fixture({
    'src-tauri/src/lib.rs': `mod used; #[path = "nested/custom.rs"] mod custom;`,
    'src-tauri/src/used.rs': `pub fn used() {}`,
    'src-tauri/src/nested/custom.rs': `pub fn custom() {}`,
    'src-tauri/src/orphan.rs': `pub fn orphan() {}`,
    'src-tauri/src/ignored_tests.rs': `pub fn test_only() {}`,
  })
  try {
    assert.deepEqual(findOrphanRustModules({ root }), ['src-tauri/src/orphan.rs'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
