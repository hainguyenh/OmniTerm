import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)

async function source(path) {
  return readFile(new URL(path, root), 'utf8')
}

test('workspace wire contract always emits pins and normalizes legacy omitted pins', async () => {
  const protocol = await source('crates/app-protocol/src/workspace.rs')
  const pinsField = protocol.match(/#\[serde\([^\]]+\)\]\s*pub pins: Vec<WorkspacePin>/)?.[0] ?? ''
  assert.ok(pinsField, 'Workspace.pins must keep an explicit serde field policy')
  assert.doesNotMatch(
    pinsField,
    /skip_serializing_if/,
    'Workspace.pins is required by the TypeScript contract and must serialize even when empty',
  )

  const api = await source('ui/workspaceAPI.ts')
  assert.match(api, /function normalizeWorkspace\(/, 'the Tauri boundary must normalize versioned workspace payloads')
  assert.match(api, /pins:\s*workspace\.pins\s*\?\?\s*\[\]/, 'legacy payloads without pins must normalize to []')

  const mutations = await source('ui/hooks/useWorkspaceMutations.ts')
  assert.match(mutations, /\(workspace\.pins \?\? \[\]\)\.some/, 'pin checks must stay safe if a stale payload bypasses the normalizer')
})

test('workspaces_file is not re-exported into non-test Tauri builds', async () => {
  const workspace = await source('src-tauri/src/workspace.rs')
  const normalReExport = workspace.match(/pub\(crate\) use crate::workspace_persistence::\{[^}]+\};/)?.[0] ?? ''
  assert.ok(normalReExport, 'workspace persistence helpers must remain explicitly imported')
  assert.doesNotMatch(normalReExport, /workspaces_file/, 'test-only path helper must not cause a normal-build unused import')
  assert.match(workspace, /#\[cfg\(test\)\]\s*pub\(crate\) use crate::workspace_persistence::workspaces_file;/)
})
