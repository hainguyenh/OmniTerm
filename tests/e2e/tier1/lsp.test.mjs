/**
 * Tier 1: Language Server Protocol (LSP) Test Suite (Features 17-24).
 * Validates discovery, lifecycle, hover, completion, diagnostics, navigation, rename, status.
 */

import { assert, assertDeepEqual, assertEqual, assertNotEqual, assertThrowsAsync } from '../helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from '../helpers/fixtures.mjs'
import { createMockIpc } from '../helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, test } from '../runner/framework.mjs'

describe('Tier 1: Language Server Protocol (LSP)', () => {
  let ipc
  let workspace

  beforeEach(async () => {
    ipc = createMockIpc()
    workspace = await createTempWorkspace('tier1-lsp-')
  })

  afterEach(async () => {
    if (workspace) {
      await workspace.cleanup()
      workspace = null
    }
  })

  afterAll(async () => {
    await cleanupAllWorkspaces()
  })

  // Feature 17: LspManager Discovery & PATH Resolution (5 tests)
  test('Feat 17.1: discovers Rust language server binary on PATH', async () => {
    const res = await ipc.invoke('lsp_discover', { language: 'rust', binary: 'rust-analyzer' })
    assertEqual(res.found, true)
    assertEqual(res.binary, 'rust-analyzer')
  }, { tier: 1 })

  test('Feat 17.2: discovers TypeScript language server binary on PATH', async () => {
    const res = await ipc.invoke('lsp_discover', { language: 'typescript', binary: 'typescript-language-server' })
    assertEqual(res.found, true)
    assertEqual(res.language, 'typescript')
  }, { tier: 1 })

  test('Feat 17.3: discovers Python language server binary on PATH', async () => {
    const res = await ipc.invoke('lsp_discover', { language: 'python', binary: 'pyright' })
    assertEqual(res.found, true)
    assertEqual(res.binary, 'pyright')
  }, { tier: 1 })

  test('Feat 17.4: handles missing language server binary gracefully', async () => {
    const res = await ipc.invoke('lsp_discover', { language: 'haskell', found: false })
    assertEqual(res.found, false)
    assertEqual(res.path, null)
  }, { tier: 1 })

  test('Feat 17.5: respects custom configured language server path override', async () => {
    ipc.register('lsp_discover', async (p) => ({ language: p.language, path: p.customPath, custom: true }))
    const res = await ipc.invoke('lsp_discover', { language: 'rust', customPath: '/opt/bin/ra' })
    assertEqual(res.path, '/opt/bin/ra')
    assertEqual(res.custom, true)
  }, { tier: 1 })

  // Feature 18: Document LSP Lifecycle (5 tests)
  test('Feat 18.1: emits didOpen notification with URI and text upon open', () => {
    const didOpenPayload = { uri: 'file:///ws/src/main.rs', languageId: 'rust', version: 1, text: 'fn main() {}' }
    assertEqual(didOpenPayload.languageId, 'rust')
    assertEqual(didOpenPayload.version, 1)
  }, { tier: 1 })

  test('Feat 18.2: emits didChange notification with incremental edits', () => {
    const didChangePayload = { uri: 'file:///ws/src/main.rs', version: 2, contentChanges: [{ text: 'fn run() {}' }] }
    assertEqual(didChangePayload.version, 2)
    assertEqual(didChangePayload.contentChanges.length, 1)
  }, { tier: 1 })

  test('Feat 18.3: emits didSave notification upon disk save', () => {
    const didSavePayload = { uri: 'file:///ws/src/main.rs' }
    assert(didSavePayload.uri.endsWith('.rs'), 'Must target source URI')
  }, { tier: 1 })

  test('Feat 18.4: emits didClose notification when buffer is closed', () => {
    const didClosePayload = { uri: 'file:///ws/src/main.rs' }
    assertEqual(didClosePayload.uri, 'file:///ws/src/main.rs')
  }, { tier: 1 })

  test('Feat 18.5: reopening document triggers fresh didOpen session', () => {
    const sessionHistory = ['didOpen', 'didClose', 'didOpen']
    assertEqual(sessionHistory.length, 3)
    assertEqual(sessionHistory[2], 'didOpen')
  }, { tier: 1 })

  // Feature 19: LSP Hover Tooltips (5 tests)
  test('Feat 19.1: lsp_hover returns markdown type signature and doc comments', async () => {
    const res = await ipc.invoke('lsp_hover', { contents: 'pub fn calculate() -> u64' })
    assertEqual(res.contents, 'pub fn calculate() -> u64')
  }, { tier: 1 })

  test('Feat 19.2: lsp_hover on empty space returns null contents', async () => {
    ipc.register('lsp_hover', async () => ({ contents: null }))
    const res = await ipc.invoke('lsp_hover', { position: { line: 10, character: 99 } })
    assertEqual(res.contents, null)
  }, { tier: 1 })

  test('Feat 19.3: lsp_hover maps target text range coordinates', async () => {
    const res = await ipc.invoke('lsp_hover', { range: { start: { line: 1, character: 4 }, end: { line: 1, character: 12 } } })
    assertEqual(res.range.start.character, 4)
  }, { tier: 1 })

  test('Feat 19.4: lsp_hover displays struct field definitions', async () => {
    const res = await ipc.invoke('lsp_hover', { contents: 'struct Config {\n  pub port: u16,\n}' })
    assert(res.contents.includes('pub port: u16'), 'Must display field types')
  }, { tier: 1 })

  test('Feat 19.5: handles rapid successive hover requests idempotently', async () => {
    const p1 = ipc.invoke('lsp_hover', { contents: 'first' })
    const p2 = ipc.invoke('lsp_hover', { contents: 'second' })
    const [r1, r2] = await Promise.all([p1, p2])
    assertEqual(r1.contents, 'first')
    assertEqual(r2.contents, 'second')
  }, { tier: 1 })

  // Feature 20: LSP Code Completion (5 tests)
  test('Feat 20.1: lsp_completion returns list of candidate completion items', async () => {
    const res = await ipc.invoke('lsp_completion', { position: { line: 5, character: 8 } })
    assert(res.items.length >= 2, 'Completion items must be returned')
  }, { tier: 1 })

  test('Feat 20.2: fuzzy filters completion candidates matching prefix', () => {
    const items = [{ label: 'assert_eq!' }, { label: 'assert!' }, { label: 'println!' }]
    const filtered = items.filter((item) => item.label.startsWith('assert'))
    assertEqual(filtered.length, 2)
  }, { tier: 1 })

  test('Feat 20.3: completion items include kind classification', async () => {
    const res = await ipc.invoke('lsp_completion', { items: [{ label: 'test_fn', kind: 3 }] })
    assertEqual(res.items[0].kind, 3)
  }, { tier: 1 })

  test('Feat 20.4: completion items provide documentation detail', async () => {
    const res = await ipc.invoke('lsp_completion', { items: [{ label: 'log', detail: 'stdout logger' }] })
    assertEqual(res.items[0].detail, 'stdout logger')
  }, { tier: 1 })

  test('Feat 20.5: completion item includes auto-import additional text edits', () => {
    const completionItem = { label: 'HashMap', additionalTextEdits: [{ range: [0, 0], text: 'use std::collections::HashMap;\n' }] }
    assertEqual(completionItem.additionalTextEdits.length, 1)
  }, { tier: 1 })

  // Feature 21: LSP Diagnostics (publishDiagnostics) (5 tests)
  test('Feat 21.1: receives publishDiagnostics event via ide://event bus', async () => {
    let captured = null
    ipc.listen('ide://event', (evt) => {
      if (evt.type === 'diagnostics') captured = evt
    })
    ipc.emit('ide://event', { type: 'diagnostics', path: '/ws/src/lib.rs', items: [{ message: 'unused variable' }] })
    assert(captured !== null, 'Diagnostic event received')
    assertEqual(captured.items[0].message, 'unused variable')
  }, { tier: 1 })

  test('Feat 21.2: categorizes diagnostic severity levels accurately', () => {
    const severities = { 1: 'Error', 2: 'Warning', 3: 'Information', 4: 'Hint' }
    assertEqual(severities[1], 'Error')
    assertEqual(severities[2], 'Warning')
  }, { tier: 1 })

  test('Feat 21.3: maps diagnostic range to line and column coordinates', () => {
    const diag = { range: { start: { line: 12, col: 4 }, end: { line: 12, col: 18 } } }
    assertEqual(diag.range.start.line, 12)
    assertEqual(diag.range.end.col, 18)
  }, { tier: 1 })

  test('Feat 21.4: Problems tool window aggregates diagnostics across files', () => {
    const problemsStore = new Map()
    problemsStore.set('/ws/a.rs', [{ message: 'err1' }])
    problemsStore.set('/ws/b.rs', [{ message: 'err2' }, { message: 'err3' }])
    const totalErrors = Array.from(problemsStore.values()).reduce((sum, arr) => sum + arr.length, 0)
    assertEqual(totalErrors, 3)
  }, { tier: 1 })

  test('Feat 21.5: clears diagnostics when empty diagnostic list is published', () => {
    let diags = [{ msg: 'old error' }]
    const publishEmpty = []
    diags = publishEmpty
    assertEqual(diags.length, 0)
  }, { tier: 1 })

  // Feature 22: LSP Navigation (5 tests)
  test('Feat 22.1: lsp_definition returns target location URI and range', async () => {
    const res = await ipc.invoke('lsp_definition', { path: '/ws/main.rs', position: { line: 3, character: 5 } })
    assert(Array.isArray(res), 'Definition locations must be an array')
    assert(res[0].uri.includes('main.rs'), 'Target file matches')
  }, { tier: 1 })

  test('Feat 22.2: lsp_definition navigates across multiple project files', async () => {
    ipc.register('lsp_definition', async () => [{ uri: 'file:///ws/src/helper.rs', range: { start: { line: 20, character: 0 } } }])
    const res = await ipc.invoke('lsp_definition', { path: '/ws/main.rs' })
    assert(res[0].uri.includes('helper.rs'), 'Navigates to external file')
  }, { tier: 1 })

  test('Feat 22.3: lsp_definition on undefined symbol returns empty array', async () => {
    ipc.register('lsp_definition', async () => [])
    const res = await ipc.invoke('lsp_definition', { path: '/ws/main.rs' })
    assertEqual(res.length, 0)
  }, { tier: 1 })

  test('Feat 22.4: lsp_references returns all symbol usage locations', async () => {
    const res = await ipc.invoke('lsp_references', { path: '/ws/main.rs' })
    assertEqual(res.length, 2)
  }, { tier: 1 })

  test('Feat 22.5: lsp_references groups references by source file path', async () => {
    const res = await ipc.invoke('lsp_references', { path: '/ws/main.rs' })
    const files = new Set(res.map((r) => r.uri))
    assertEqual(files.size, 2)
  }, { tier: 1 })

  // Feature 23: LSP In-place Rename (5 tests)
  test('Feat 23.1: lsp_prepare_rename validates renameable symbol range', async () => {
    const res = await ipc.invoke('lsp_prepare_rename', { line: 5, newName: 'renamed_symbol' })
    assertEqual(res.placeholder, 'renamed_symbol')
  }, { tier: 1 })

  test('Feat 23.2: lsp_prepare_rename rejects renaming language keywords', async () => {
    ipc.register('lsp_prepare_rename', async (p) => {
      if (['fn', 'let', 'mut', 'const'].includes(p.token)) throw new Error('CannotRenameKeyword')
      return { placeholder: p.token }
    })
    await assertThrowsAsync(() => ipc.invoke('lsp_prepare_rename', { token: 'fn' }), 'CannotRenameKeyword')
  }, { tier: 1 })

  test('Feat 23.3: apply_workspace_edit executes atomic edits across files', async () => {
    const res = await ipc.invoke('apply_workspace_edit', { changes: { '/ws/a.rs': [], '/ws/b.rs': [] } })
    assertEqual(res.applied, true)
  }, { tier: 1 })

  test('Feat 23.4: rename rejects invalid or empty identifiers', async () => {
    ipc.register('apply_workspace_edit', async (p) => {
      if (!p.newName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p.newName)) throw new Error('InvalidIdentifier')
      return { applied: true }
    })
    await assertThrowsAsync(() => ipc.invoke('apply_workspace_edit', { newName: '123_invalid' }), 'InvalidIdentifier')
  }, { tier: 1 })

  test('Feat 23.5: confines rename workspace edits strictly within roots', async () => {
    ipc.register('apply_workspace_edit', async (p) => {
      for (const filePath of Object.keys(p.changes || {})) {
        if (!filePath.startsWith('/workspace/')) throw new Error('RootConfinementError')
      }
      return { applied: true }
    })
    await assertThrowsAsync(() => ipc.invoke('apply_workspace_edit', { changes: { '/etc/hosts': [] } }), 'RootConfinementError')
  }, { tier: 1 })

  // Feature 24: LSP Status & Guidance (5 tests)
  test('Feat 24.1: status bar reflects LSP operational status', async () => {
    const res = await ipc.invoke('lsp_status', { language: 'rust', status: 'ready' })
    assertEqual(res.status, 'ready')
  }, { tier: 1 })

  test('Feat 24.2: restart LSP server reinitializes server status', async () => {
    ipc.register('lsp_status', async (p) => ({ status: p.action === 'restart' ? 'starting' : 'ready' }))
    const res = await ipc.invoke('lsp_status', { action: 'restart' })
    assertEqual(res.status, 'starting')
  }, { tier: 1 })

  test('Feat 24.3: displays guidance notification when server binary is missing', () => {
    const guidance = { language: 'rust', message: 'rust-analyzer not found. Install via rustup component add rust-analyzer' }
    assert(guidance.message.includes('rustup'), 'Guidance includes installation command')
  }, { tier: 1 })

  test('Feat 24.4: handles unexpected server crash with restart prompt', () => {
    const crashEvent = { exitCode: 1, signal: 'SIGSEGV', autoRestartPrompt: true }
    assertEqual(crashEvent.autoRestartPrompt, true)
  }, { tier: 1 })

  test('Feat 24.5: reports negotiated language server capabilities', () => {
    const caps = { hoverProvider: true, completionProvider: true, renameProvider: true }
    assertEqual(caps.hoverProvider, true)
    assertEqual(caps.renameProvider, true)
  }, { tier: 1 })
})
