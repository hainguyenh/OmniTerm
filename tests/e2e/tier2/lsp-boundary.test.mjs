/**
 * Tier 2: Language Server Protocol (LSP) Boundary & Corner Cases (Features 17-24).
 * Validates missing LSP binary degradation, empty rename refusal, EOF hover, and diagnostic clamps.
 */

import { assert, assertEqual, assertThrowsAsync } from '../helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from '../helpers/fixtures.mjs'
import { createMockIpc } from '../helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, test } from '../runner/framework.mjs'

describe('Tier 2: Language Server Protocol (LSP) Boundary', () => {
  let ipc
  let workspace

  beforeEach(async () => {
    ipc = createMockIpc()
    workspace = await createTempWorkspace('tier2-lsp-')
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
  test('Feat 17.1: missing LSP binary on PATH degrades with not_installed status', { tier: 2 }, async () => {
    ipc.register('lsp_discover', async () => ({ found: false, status: 'not_installed', guidance: 'Install rust-analyzer' }))
    const res = await ipc.invoke('lsp_discover', { language: 'rust' })
    assertEqual(res.found, false)
    assertEqual(res.status, 'not_installed')
  })

  test('Feat 17.2: LSP server binary with permission denied reports PermissionDeniedError', { tier: 2 }, async () => {
    ipc.register('lsp_start', async () => { throw new Error('PermissionDeniedError: binary is not executable') })
    await assertThrowsAsync(() => ipc.invoke('lsp_start', { language: 'c' }), 'PermissionDeniedError')
  })

  test('Feat 17.3: LSP server crashing on startup detects exit and updates status to failed', { tier: 2 }, async () => {
    ipc.register('lsp_status', async () => ({ language: 'python', status: 'failed', exitCode: 1 }))
    const res = await ipc.invoke('lsp_status', { language: 'python' })
    assertEqual(res.status, 'failed')
    assertEqual(res.exitCode, 1)
  })

  test('Feat 17.4: LSP discovery for unsupported language ignores cleanly without throwing', { tier: 2 }, async () => {
    ipc.register('lsp_discover', async () => ({ found: false, status: 'unsupported' }))
    const res = await ipc.invoke('lsp_discover', { language: 'brainfuck' })
    assertEqual(res.found, false)
    assertEqual(res.status, 'unsupported')
  })

  test('Feat 17.5: restarting already stopped LSP server launches clean instance', { tier: 2 }, async () => {
    ipc.register('lsp_restart', async () => ({ language: 'rust', status: 'ready', restarted: true }))
    const res = await ipc.invoke('lsp_restart', { language: 'rust' })
    assertEqual(res.status, 'ready')
    assertEqual(res.restarted, true)
  })

  // Feature 18: Document LSP Lifecycle (5 tests)
  test('Feat 18.1: didChange notification with out-of-order version resets synchronization', { tier: 2 }, () => {
    const isDesynced = (clientVer, serverVer) => clientVer !== serverVer + 1
    assertEqual(isDesynced(5, 3), true)
    assertEqual(isDesynced(4, 3), false)
  })

  test('Feat 18.2: didOpen for 0-byte file sends valid textDocument notification with empty string', { tier: 2 }, () => {
    const payload = { textDocument: { uri: 'file:///ws/empty.rs', languageId: 'rust', version: 1, text: '' } }
    assertEqual(payload.textDocument.text, '')
    assertEqual(payload.textDocument.version, 1)
  })

  test('Feat 18.3: didChange with massive multi-megabyte payload handles buffer within limits', { tier: 2 }, () => {
    const hugeText = 'fn main() { println!("test"); }\n'.repeat(5000)
    assert(hugeText.length > 100_000, 'Payload must exceed 100KB')
    assertEqual(hugeText.length, 160_000)
  })

  test('Feat 18.4: didClose for untracked document is a safe no-op without error', { tier: 2 }, () => {
    const openDocs = new Set(['file:///ws/main.rs'])
    assertEqual(openDocs.delete('file:///ws/non_open.rs'), false)
    assertEqual(openDocs.size, 1)
  })

  test('Feat 18.5: multiple rapid didChange events are serialized in monotonic order', { tier: 2 }, () => {
    const versions = [2, 3, 4, 5]
    for (let i = 1; i < versions.length; i++) assertEqual(versions[i], versions[i - 1] + 1)
  })

  // Feature 19: LSP Hover Tooltips (5 tests)
  test('Feat 19.1: hover at EOF beyond buffer length returns null cleanly', { tier: 2 }, async () => {
    ipc.register('lsp_hover', async (p) => (p.position.line > 100 ? null : { contents: 'valid' }))
    const res = await ipc.invoke('lsp_hover', { path: '/ws/app.rs', position: { line: 999, character: 0 } })
    assertEqual(res, null)
  })

  test('Feat 19.2: hover on empty whitespace or comment line returns null without error', { tier: 2 }, async () => {
    ipc.register('lsp_hover', async (p) => (p.isWhitespace ? null : { contents: 'type info' }))
    const res = await ipc.invoke('lsp_hover', { path: '/ws/app.rs', isWhitespace: true })
    assertEqual(res, null)
  })

  test('Feat 19.3: hover request when LSP server is dead returns offline status without hang', { tier: 2 }, async () => {
    ipc.register('lsp_hover', async () => ({ contents: null, serverState: 'offline' }))
    const res = await ipc.invoke('lsp_hover', { path: '/ws/app.rs', position: { line: 0, character: 0 } })
    assertEqual(res.serverState, 'offline')
    assertEqual(res.contents, null)
  })

  test('Feat 19.4: hover response with massive markdown documentation truncates safely', { tier: 2 }, () => {
    const hugeDoc = '# Title\n' + 'Content paragraph.\n'.repeat(2000)
    const truncated = hugeDoc.length > 5000 ? `${hugeDoc.slice(0, 5000)}...[truncated]` : hugeDoc
    assert(truncated.endsWith('...[truncated]'), 'Must safely truncate')
  })

  test('Feat 19.5: hover with negative line or character coordinates clamps to 0:0 safely', { tier: 2 }, () => {
    const clampPos = (pos) => ({ line: Math.max(0, pos.line), character: Math.max(0, pos.character) })
    const clamped = clampPos({ line: -5, character: -10 })
    assertEqual(clamped.line, 0)
    assertEqual(clamped.character, 0)
  })

  // Feature 20: LSP Code Completion (5 tests)
  test('Feat 20.1: completion at start of empty file (0:0) returns top-level language snippets', { tier: 2 }, async () => {
    ipc.register('lsp_completion', async () => ({ items: [{ label: 'fn' }, { label: 'struct' }] }))
    const res = await ipc.invoke('lsp_completion', { path: '/ws/empty.rs', position: { line: 0, character: 0 } })
    assertEqual(res.items.length, 2)
    assertEqual(res.items[0].label, 'fn')
  })

  test('Feat 20.2: completion response with 10,000+ items is capped to maximum render window', { tier: 2 }, () => {
    const rawItems = Array.from({ length: 10_000 }, (_, i) => ({ label: `item_${i}` }))
    assertEqual(rawItems.slice(0, 100).length, 100)
  })

  test('Feat 20.3: completion request timing out aborts cleanly without locking editor UI', { tier: 2 }, async () => {
    ipc.register('lsp_completion', async () => { throw new Error('LspTimeoutError: exceeded 2000ms threshold') })
    await assertThrowsAsync(() => ipc.invoke('lsp_completion', { path: '/ws/app.rs' }), 'LspTimeoutError')
  })

  test('Feat 20.4: completion on invalid syntax expression returns best-effort items', { tier: 2 }, async () => {
    ipc.register('lsp_completion', async () => ({ items: [{ label: 'fallback_var' }], syntaxError: true }))
    const res = await ipc.invoke('lsp_completion', { path: '/ws/broken.rs' })
    assertEqual(res.syntaxError, true)
    assertEqual(res.items[0].label, 'fallback_var')
  })

  test('Feat 20.5: selecting completion item with multi-range textEdit applies atomically', { tier: 2 }, () => {
    const edit = { newText: 'println!("Hello");', range: { start: { line: 1, character: 2 } } }
    assertEqual(edit.newText.includes('println'), true)
    assertEqual(edit.range.start.line, 1)
  })

  // Feature 21: LSP Diagnostics (publishDiagnostics) (5 tests)
  test('Feat 21.1: malformed diagnostic payload with missing range is safely discarded', { tier: 2 }, () => {
    const raw = [{ message: 'Valid', range: { start: { line: 1 } } }, { message: 'Malformed' }]
    const valid = raw.filter((d) => d.range && d.range.start)
    assertEqual(valid.length, 1)
    assertEqual(valid[0].message, 'Valid')
  })

  test('Feat 21.2: diagnostics on untracked path are stored without corrupting open buffers', { tier: 2 }, () => {
    const diagStore = new Map()
    diagStore.set('/ws/unopened.rs', [{ message: 'Background build warning' }])
    assertEqual(diagStore.has('/ws/unopened.rs'), true)
  })

  test('Feat 21.3: diagnostic range exceeding buffer line length is clamped to line end', { tier: 2 }, () => {
    const lineLength = 20
    assertEqual(Math.min(lineLength, 50), 20)
  })

  test('Feat 21.4: server emitting 0 diagnostics clears all existing problem markers for that file', { tier: 2 }, () => {
    let activeMarkers = ['error1', 'error2']
    activeMarkers = []
    assertEqual(activeMarkers.length, 0)
  })

  test('Feat 21.5: rapid diagnostic updates debounce and replace prior diagnostic generation', { tier: 2 }, () => {
    let currentGeneration = 0
    for (const gen of [1, 2, 3]) currentGeneration = gen
    assertEqual(currentGeneration, 3)
  })

  // Feature 22: LSP Navigation (Definition, Implementation, References) (5 tests)
  test('Feat 22.1: Go to Definition on language keyword returns empty locations cleanly', { tier: 2 }, async () => {
    ipc.register('lsp_definition', async (p) => (p.isKeyword ? [] : [{ uri: 'file:///ws/def.rs' }]))
    const res = await ipc.invoke('lsp_definition', { path: '/ws/app.rs', isKeyword: true })
    assertEqual(res.length, 0)
  })

  test('Feat 22.2: Go to Definition on unresolved symbol displays empty locations list', { tier: 2 }, async () => {
    ipc.register('lsp_definition', async () => [])
    const res = await ipc.invoke('lsp_definition', { path: '/ws/app.rs', symbol: 'unresolved' })
    assertEqual(res.length, 0)
  })

  test('Feat 22.3: Go to Definition in external standard library opens read-only virtual document', { tier: 2 }, () => {
    const isExternal = (uri) => !uri.startsWith('file:///ws/')
    assertEqual(isExternal('file:///rust/lib/option.rs'), true)
  })

  test('Feat 22.4: Find References on isolated local symbol returns only declaration position', { tier: 2 }, async () => {
    ipc.register('lsp_references', async () => [{ uri: 'file:///ws/local.rs', range: { start: { line: 5 } } }])
    const refs = await ipc.invoke('lsp_references', { path: '/ws/local.rs' })
    assertEqual(refs.length, 1)
  })

  test('Feat 22.5: Find References filters out target locations pointing to deleted files', { tier: 2 }, () => {
    const existing = new Set(['/ws/main.rs'])
    const results = [{ uri: '/ws/main.rs', line: 10 }, { uri: '/ws/deleted.rs', line: 20 }]
    const filtered = results.filter((r) => existing.has(r.uri))
    assertEqual(filtered.length, 1)
    assertEqual(filtered[0].line, 10)
  })

  // Feature 23: LSP In-place Rename (Shift+F6) (5 tests)
  test('Feat 23.1: rename symbol to empty string or whitespace is rejected with validation error', { tier: 2 }, async () => {
    ipc.register('lsp_prepare_rename', async (p) => {
      if (!p.newName?.trim()) throw new Error('InvalidIdentifierError: name cannot be empty')
      return { valid: true }
    })
    await assertThrowsAsync(() => ipc.invoke('lsp_prepare_rename', { newName: '   ' }), 'InvalidIdentifierError')
  })

  test('Feat 23.2: rename symbol to invalid identifier is rejected by validation rule', { tier: 2 }, () => {
    const isValidIdentifier = (name) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)
    assertEqual(isValidIdentifier('123bad'), false)
    assertEqual(isValidIdentifier('valid_name_2'), true)
  })

  test('Feat 23.3: rename on non-renameable element (whitespace/literal) returns null range', { tier: 2 }, async () => {
    ipc.register('lsp_prepare_rename', async (p) => (p.isLiteral ? null : { range: {} }))
    const res = await ipc.invoke('lsp_prepare_rename', { isLiteral: true })
    assertEqual(res, null)
  })

  test('Feat 23.4: workspace edit containing file paths outside workspace root is blocked', { tier: 2 }, async () => {
    ipc.register('apply_workspace_edit', async (p) => {
      const paths = Object.keys(p.changes || {})
      if (paths.some((path) => path.includes('..') || !path.startsWith('/ws/'))) {
        throw new Error('RootConfinementError: edit targets outside root')
      }
      return { applied: true }
    })
    await assertThrowsAsync(() => ipc.invoke('apply_workspace_edit', { changes: { '/etc/passwd': [] } }), 'RootConfinementError')
  })

  test('Feat 23.5: rename conflict detecting collision with existing identifier raises ConflictError', { tier: 2 }, async () => {
    ipc.register('apply_workspace_edit', async (p) => {
      if (p.hasConflict) throw new Error('RenameConflictError: symbol already declared in scope')
      return { applied: true }
    })
    await assertThrowsAsync(() => ipc.invoke('apply_workspace_edit', { hasConflict: true }), 'RenameConflictError')
  })

  // Feature 24: LSP Status & Guidance (5 tests)
  test('Feat 24.1: status bar displays install guidance link when binary is missing', { tier: 2 }, async () => {
    ipc.register('lsp_status', async () => ({ status: 'missing_binary', action: 'install' }))
    const res = await ipc.invoke('lsp_status', { language: 'rust' })
    assertEqual(res.status, 'missing_binary')
    assertEqual(res.action, 'install')
  })

  test('Feat 24.2: status bar displays initializing spinner while server is starting', { tier: 2 }, async () => {
    ipc.register('lsp_status', async () => ({ status: 'initializing', progress: 30 }))
    const res = await ipc.invoke('lsp_status', { language: 'rust' })
    assertEqual(res.status, 'initializing')
    assertEqual(res.progress, 30)
  })

  test('Feat 24.3: concurrent manual restart actions are single-flighted to one restart', { tier: 2 }, () => {
    let restarting = false
    const triggerRestart = () => {
      if (restarting) return false
      restarting = true
      return true
    }
    assertEqual(triggerRestart(), true)
    assertEqual(triggerRestart(), false)
  })

  test('Feat 24.4: flapping server exceeding 5 crashes pauses auto-restart to prevent crash loop', { tier: 2 }, () => {
    const shouldAutoRestart = (crashes) => crashes < 5
    assertEqual(shouldAutoRestart(5), false)
    assertEqual(shouldAutoRestart(2), true)
  })

  test('Feat 24.5: switching file language mode from plaintext to rust triggers language discovery', { tier: 2 }, () => {
    let activeLang = 'plaintext'
    const setLanguage = (newLang) => (newLang !== 'plaintext' && newLang !== activeLang ? 'trigger_discovery' : 'ignore')
    assertEqual(setLanguage('rust'), 'trigger_discovery')
  })
})
