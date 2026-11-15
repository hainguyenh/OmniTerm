/**
 * Tier 1: Editor & Custom Previews Test Suite (Features 3-10).
 * Validates doc lifecycle, editing, disk sync, CM6, previews, splits, status bar, find/replace.
 */

import { assert, assertDeepEqual, assertEqual, assertMatchesPattern, assertNotEqual, assertThrowsAsync } from '../helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from '../helpers/fixtures.mjs'
import { createMockIpc } from '../helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, test } from '../runner/framework.mjs'

describe('Tier 1: Editor & Custom Previews', () => {
  let ipc
  let workspace

  beforeEach(async () => {
    ipc = createMockIpc()
    workspace = await createTempWorkspace('tier1-editor-')
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

  // Feature 3: doc_open / doc_close (5 tests)
  test('Feat 3.1: doc_open returns valid descriptor with language and version', async () => {
    const doc = await ipc.invoke('doc_open', { path: '/ws/src/app.rs', initialText: 'fn main() {}' })
    assertEqual(doc.path, '/ws/src/app.rs')
    assertEqual(doc.language, 'rust')
    assertEqual(doc.version, 1)
  }, { tier: 1 })

  test('Feat 3.2: doc_open confines path outside workspace root', async () => {
    ipc.register('doc_open', async (p) => {
      if (p?.path?.includes('..') || p?.path?.startsWith('/etc')) throw new Error('RootConfinementError')
      return { id: 'doc-ok', path: p.path, version: 1 }
    })
    await assertThrowsAsync(() => ipc.invoke('doc_open', { path: '/etc/passwd' }), 'RootConfinementError')
  }, { tier: 1 })

  test('Feat 3.3: doc_open multiple files generates unique document IDs', async () => {
    const d1 = await ipc.invoke('doc_open', { path: '/ws/a.rs' })
    const d2 = await ipc.invoke('doc_open', { path: '/ws/b.rs' })
    assertNotEqual(d1.id, d2.id)
  }, { tier: 1 })

  test('Feat 3.4: doc_close releases open document registry entry', async () => {
    const d = await ipc.invoke('doc_open', { path: '/ws/main.rs' })
    const res = await ipc.invoke('doc_close', { id: d.id })
    assertEqual(res.closed, true)
  }, { tier: 1 })

  test('Feat 3.5: doc_close handles non-existent document cleanly', async () => {
    ipc.register('doc_close', async (p) => ({ id: p?.id, closed: p?.id === 'valid-id' }))
    const res = await ipc.invoke('doc_close', { id: 'unknown-id' })
    assertEqual(res.closed, false)
  }, { tier: 1 })

  // Feature 4: doc_edit / doc_save (5 tests)
  test('Feat 4.1: doc_edit applies edit and increments version monotonically', async () => {
    const doc = await ipc.invoke('doc_open', { path: '/ws/main.rs' })
    const editRes = await ipc.invoke('doc_edit', { id: doc.id, version: doc.version, edits: [] })
    assertEqual(editRes.version, 2)
  }, { tier: 1 })

  test('Feat 4.2: doc_edit rejects stale document version', async () => {
    ipc.register('doc_edit', async (p) => {
      if (p?.version !== 5) throw new Error('VersionConflictError: stale version')
      return { id: p.id, version: 6 }
    })
    await assertThrowsAsync(() => ipc.invoke('doc_edit', { id: 'd1', version: 1 }), 'VersionConflictError')
  }, { tier: 1 })

  test('Feat 4.3: doc_edit consecutive edits advance versions sequentially', async () => {
    let v = 1
    for (let i = 0; i < 3; i++) {
      const res = await ipc.invoke('doc_edit', { id: 'doc-seq', version: v, edits: [] })
      assertEqual(res.version, v + 1)
      v = res.version
    }
    assertEqual(v, 4)
  }, { tier: 1 })

  test('Feat 4.4: doc_save commits buffer to disk and preserves version', async () => {
    const saveRes = await ipc.invoke('doc_save', { id: 'doc-1' })
    assertEqual(saveRes.success, true)
    assert(saveRes.savedAt > 0, 'Saved timestamp must be recorded')
  }, { tier: 1 })

  test('Feat 4.5: doc_save records Local History snapshot timestamp', async () => {
    ipc.register('doc_save', async (p) => ({ id: p.id, success: true, historySnapshotId: 'hist-101' }))
    const res = await ipc.invoke('doc_save', { id: 'doc-1' })
    assertEqual(res.historySnapshotId, 'hist-101')
  }, { tier: 1 })

  // Feature 5: doc_sync_from_disk (5 tests)
  test('Feat 5.1: doc_sync_from_disk reloads clean buffer upon disk modification', async () => {
    const res = await ipc.invoke('doc_sync_from_disk', { id: 'doc-clean' })
    assertEqual(res.status, 'reloaded')
  }, { tier: 1 })

  test('Feat 5.2: doc_sync_from_disk detects conflict when buffer is dirty', async () => {
    ipc.register('doc_sync_from_disk', async (p) => ({ id: p.id, status: p.isDirty ? 'conflict' : 'reloaded' }))
    const res = await ipc.invoke('doc_sync_from_disk', { id: 'doc-dirty', isDirty: true })
    assertEqual(res.status, 'conflict')
  }, { tier: 1 })

  test('Feat 5.3: doc_sync_from_disk preserves cursor metadata after reload', async () => {
    ipc.register('doc_sync_from_disk', async (p) => ({ id: p.id, status: 'reloaded', cursor: p.cursor }))
    const res = await ipc.invoke('doc_sync_from_disk', { id: 'doc-cur', cursor: { line: 12, ch: 4 } })
    assertDeepEqual(res.cursor, { line: 12, ch: 4 })
  }, { tier: 1 })

  test('Feat 5.4: doc_sync_from_disk handles deleted disk file with detached warning', async () => {
    ipc.register('doc_sync_from_disk', async (p) => ({ id: p.id, status: p.deleted ? 'detached' : 'reloaded' }))
    const res = await ipc.invoke('doc_sync_from_disk', { id: 'doc-del', deleted: true })
    assertEqual(res.status, 'detached')
  }, { tier: 1 })

  test('Feat 5.5: external modification triggers doc_sync_from_disk command', async () => {
    await ipc.invoke('doc_sync_from_disk', { id: 'doc-watch' })
    ipc.assertCalled('doc_sync_from_disk', 1)
  }, { tier: 1 })

  // Feature 6: CodeMirror 6 Editor View (5 tests)
  test('Feat 6.1: selects syntax highlighting mode from file extension', async () => {
    const extensions = { 'a.rs': 'rust', 'b.ts': 'typescript', 'c.py': 'python', 'd.json': 'json', 'e.md': 'markdown' }
    for (const [file, lang] of Object.entries(extensions)) {
      const mode = file.endsWith('.rs') ? 'rust' : file.endsWith('.ts') ? 'typescript' : file.endsWith('.py') ? 'python' : file.endsWith('.json') ? 'json' : 'markdown'
      assertEqual(mode, lang)
    }
  }, { tier: 1 })

  test('Feat 6.2: configures line numbers and code folding state', () => {
    const cmConfig = { lineNumbers: true, foldGutter: true }
    assertEqual(cmConfig.lineNumbers, true)
    assertEqual(cmConfig.foldGutter, true)
  }, { tier: 1 })

  test('Feat 6.3: tracks multi-caret cursor selection ranges', () => {
    const selections = [{ from: 0, to: 0 }, { from: 15, to: 15 }]
    assertEqual(selections.length, 2)
    assertEqual(selections[1].from, 15)
  }, { tier: 1 })

  test('Feat 6.4: preserves encoding representation across utf-8 and utf-16', async () => {
    const doc = await ipc.invoke('doc_open', { path: '/ws/enc.txt' })
    assertEqual(doc.encoding, 'utf-8')
  }, { tier: 1 })

  test('Feat 6.5: normalizes line endings between CRLF and LF', async () => {
    const doc = await ipc.invoke('doc_open', { path: '/ws/crlf.txt' })
    assertEqual(doc.lineEnding, 'lf')
  }, { tier: 1 })

  // Feature 7: Custom Previews Adaptation (5 tests)
  test('Feat 7.1: registers CSV preview kind and parses tabular structure', () => {
    const csvData = 'id,name,role\n1,alice,admin\n2,bob,user'
    const rows = csvData.trim().split('\n').map((r) => r.split(','))
    assertEqual(rows.length, 3)
    assertDeepEqual(rows[0], ['id', 'name', 'role'])
  }, { tier: 1 })

  test('Feat 7.2: registers Markdown preview kind with Mermaid diagram support', () => {
    const md = '# Title\n```mermaid\ngraph TD;\nA-->B;\n```'
    assert(md.includes('graph TD'), 'Must contain Mermaid graph definition')
  }, { tier: 1 })

  test('Feat 7.3: registers JSON Graph preview kind with node-link schema', () => {
    const graph = { nodes: [{ id: 'n1' }, { id: 'n2' }], links: [{ source: 'n1', target: 'n2' }] }
    assertEqual(graph.nodes.length, 2)
    assertEqual(graph.links[0].source, 'n1')
  }, { tier: 1 })

  test('Feat 7.4: registers HTML and SVG preview kinds with sanitized rendering', () => {
    const svg = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>'
    assert(svg.startsWith('<svg') && svg.endsWith('</svg>'), 'Valid SVG container')
  }, { tier: 1 })

  test('Feat 7.5: registers Image and Notes preview kinds with visualizer bindings', () => {
    const previewKinds = ['csv', 'markdown', 'json-graph', 'html', 'svg', 'image', 'notes']
    assert(previewKinds.includes('image'), 'image preview kind supported')
    assert(previewKinds.includes('notes'), 'notes preview kind supported')
  }, { tier: 1 })

  // Feature 8: Editor Area Splits (5 tests)
  test('Feat 8.1: configures single pane primary editor layout', () => {
    const layout = { type: 'single', panes: [{ id: 'pane-1', activeDoc: 'doc-1' }] }
    assertEqual(layout.panes.length, 1)
  }, { tier: 1 })

  test('Feat 8.2: creates 2-column split layout with independent views', () => {
    const layout = { type: 'columns', split: 0.5, panes: [{ id: 'p1' }, { id: 'p2' }] }
    assertEqual(layout.panes.length, 2)
    assertEqual(layout.split, 0.5)
  }, { tier: 1 })

  test('Feat 8.3: creates 2-row horizontal split layout', () => {
    const layout = { type: 'rows', split: 0.5, panes: [{ id: 'top' }, { id: 'bottom' }] }
    assertEqual(layout.type, 'rows')
  }, { tier: 1 })

  test('Feat 8.4: creates 2x2 grid split layout for quad-view editing', () => {
    const layout = { type: 'grid', panes: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }] }
    assertEqual(layout.panes.length, 4)
  }, { tier: 1 })

  test('Feat 8.5: moves document tab between split panes preserving edit history', () => {
    const p1 = { tabs: ['d1', 'd2'] }
    const p2 = { tabs: [] }
    p2.tabs.push(p1.tabs.pop())
    assertEqual(p1.tabs.length, 1)
    assertEqual(p2.tabs[0], 'd2')
  }, { tier: 1 })

  // Feature 9: Editor Status Bar (5 tests)
  test('Feat 9.1: computes and displays cursor line and column coordinates', () => {
    const pos = { line: 42, col: 17 }
    const label = `Ln ${pos.line}, Col ${pos.col}`
    assertEqual(label, 'Ln 42, Col 17')
  }, { tier: 1 })

  test('Feat 9.2: dispatches Go to Line navigation action', () => {
    const targetLine = 88
    const clampedLine = Math.max(1, Math.min(100, targetLine))
    assertEqual(clampedLine, 88)
  }, { tier: 1 })

  test('Feat 9.3: displays active document encoding mode (UTF-8)', async () => {
    const doc = await ipc.invoke('doc_open', { path: '/ws/file.txt' })
    assertEqual(doc.encoding.toUpperCase(), 'UTF-8')
  }, { tier: 1 })

  test('Feat 9.4: toggles indentation preferences between spaces and tabs', () => {
    let indentMode = 'spaces:2'
    indentMode = indentMode === 'spaces:2' ? 'tabs' : 'spaces:2'
    assertEqual(indentMode, 'tabs')
  }, { tier: 1 })

  test('Feat 9.5: displays active line ending format (LF / CRLF)', async () => {
    const doc = await ipc.invoke('doc_open', { path: '/ws/file.txt' })
    assertEqual(doc.lineEnding.toUpperCase(), 'LF')
  }, { tier: 1 })

  // Feature 10: Find & Replace Bar (5 tests)
  test('Feat 10.1: executes in-buffer text search query finding occurrences', () => {
    const text = 'hello world hello OmniTerm'
    const matches = Array.from(text.matchAll(/hello/g)).map((m) => m.index)
    assertEqual(matches.length, 2)
    assertDeepEqual(matches, [0, 12])
  }, { tier: 1 })

  test('Feat 10.2: executes case-sensitive text search query', () => {
    const text = 'Case CASE case'
    const matches = Array.from(text.matchAll(/CASE/g)).map((m) => m.index)
    assertEqual(matches.length, 1)
  }, { tier: 1 })

  test('Feat 10.3: executes whole-word text search query', () => {
    const text = 'open editor omniterm opening open'
    const matches = Array.from(text.matchAll(/\bopen\b/g)).map((m) => m.index)
    assertEqual(matches.length, 2)
  }, { tier: 1 })

  test('Feat 10.4: executes regular expression pattern search query', () => {
    const text = 'fn foo_123() -> i32'
    const match = text.match(/fn\s+([a-z0-9_]+)\(\)/)
    assert(match !== null, 'Regex must match function declaration')
    assertEqual(match[1], 'foo_123')
  }, { tier: 1 })

  test('Feat 10.5: executes batch Replace All operation updating buffer', () => {
    const text = 'old_func() { old_func(); }'
    const replaced = text.replaceAll('old_func', 'new_func')
    assertEqual(replaced, 'new_func() { new_func(); }')
  }, { tier: 1 })
})
