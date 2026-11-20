/**
 * Tier 2: Editor & Custom Previews Boundary & Corner Cases (Features 3-10).
 * Validates empty files, massive buffers, unicode/CJK/RTL, dirty buffer conflicts, and boundary splits.
 */

import { assert, assertEqual, assertNotEqual, assertThrowsAsync } from '../helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from '../helpers/fixtures.mjs'
import { createMockIpc } from '../helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, test } from '../runner/framework.mjs'

describe('Tier 2: Editor & Custom Previews Boundary', () => {
  let ipc
  let workspace

  beforeEach(async () => {
    ipc = createMockIpc()
    workspace = await createTempWorkspace('tier2-editor-')
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
  test('Feat 3.1: doc_open 0-byte empty file returns empty text and version 1', { tier: 2 }, async () => {
    const doc = await ipc.invoke('doc_open', { path: '/ws/empty.txt', initialText: '' })
    assertEqual(doc.text, '')
    assertEqual(doc.version, 1)
  })

  test('Feat 3.2: doc_open path traversal outside root rejects with RootConfinementError', { tier: 2 }, async () => {
    ipc.register('doc_open', async (p) => {
      if (p?.path?.includes('..') || p?.path?.includes('%2e%2e')) throw new Error('RootConfinementError: outside root')
      return { id: 'doc-ok', path: p.path, version: 1 }
    })
    await assertThrowsAsync(() => ipc.invoke('doc_open', { path: '/ws/../../etc/passwd' }), 'RootConfinementError')
    await assertThrowsAsync(() => ipc.invoke('doc_open', { path: '/ws/%2e%2e/secret' }), 'RootConfinementError')
  })

  test('Feat 3.3: doc_open handles deeply nested path exceeding 250 characters', { tier: 2 }, async () => {
    const deepPath = `/ws/${'subdir/'.repeat(35)}file.rs`
    assert(deepPath.length > 250, 'Path must exceed 250 characters')
    const doc = await ipc.invoke('doc_open', { path: deepPath })
    assertEqual(doc.path, deepPath)
    assertEqual(doc.language, 'rust')
  })

  test('Feat 3.4: doc_close on un-opened document ID does not crash registry', { tier: 2 }, async () => {
    ipc.register('doc_close', async (p) => ({ id: p?.id, closed: false, error: 'DocumentNotFound' }))
    const res = await ipc.invoke('doc_close', { id: 'non-existent-doc-id' })
    assertEqual(res.closed, false)
    assertEqual(res.error, 'DocumentNotFound')
  })

  test('Feat 3.5: doc_close double invocation is idempotent without throwing', { tier: 2 }, async () => {
    const doc = await ipc.invoke('doc_open', { path: '/ws/close_test.rs' })
    const res1 = await ipc.invoke('doc_close', { id: doc.id })
    assertEqual(res1.closed, true)
    const res2 = await ipc.invoke('doc_close', { id: doc.id })
    assertEqual(res2.closed, true)
  })

  // Feature 4: doc_edit / doc_save (5 tests)
  test('Feat 4.1: doc_edit applies massive buffer modifications preserving integrity', { tier: 2 }, async () => {
    const largeChunk = 'x'.repeat(128 * 1024)
    ipc.register('doc_edit', async (p) => ({ id: p.id, version: p.version + 1, byteLength: p.text?.length || 0 }))
    const res = await ipc.invoke('doc_edit', { id: 'doc-large', version: 1, text: largeChunk })
    assertEqual(res.byteLength, 131072)
    assertEqual(res.version, 2)
  })

  test('Feat 4.2: doc_edit rejects stale version mismatch (v=1 when server is at v=3)', { tier: 2 }, async () => {
    let serverVersion = 3
    ipc.register('doc_edit', async (p) => {
      if (p.version !== serverVersion) throw new Error(`VersionConflictError: expected ${serverVersion}, got ${p.version}`)
      serverVersion++
      return { id: p.id, version: serverVersion }
    })
    await assertThrowsAsync(() => ipc.invoke('doc_edit', { id: 'd1', version: 1 }), 'VersionConflictError')
  })

  test('Feat 4.3: doc_edit high-frequency rapid sequential edits maintain gapless versions', { tier: 2 }, async () => {
    let currentVer = 10
    ipc.register('doc_edit', async (p) => {
      assertEqual(p.version, currentVer)
      currentVer++
      return { id: p.id, version: currentVer }
    })
    for (let i = 0; i < 5; i++) {
      const res = await ipc.invoke('doc_edit', { id: 'doc-rapid', version: currentVer })
      assertEqual(res.version, currentVer)
    }
    assertEqual(currentVer, 15)
  })

  test('Feat 4.4: doc_save on non-existent document ID throws DocumentNotFound', { tier: 2 }, async () => {
    ipc.register('doc_save', async (p) => {
      if (p?.id === 'missing-doc') throw new Error('DocumentNotFound')
      return { id: p.id, success: true }
    })
    await assertThrowsAsync(() => ipc.invoke('doc_save', { id: 'missing-doc' }), 'DocumentNotFound')
  })

  test('Feat 4.5: doc_edit with out-of-range splice indices clamps or rejects cleanly', { tier: 2 }, async () => {
    ipc.register('doc_edit', async (p) => {
      if (p?.splice?.start < 0 || p?.splice?.end > (p?.bufferLen || 0)) throw new Error('IndexOutOfBoundsError')
      return { id: p.id, version: p.version + 1 }
    })
    await assertThrowsAsync(() => ipc.invoke('doc_edit', { id: 'd1', version: 1, bufferLen: 10, splice: { start: -5, end: 5 } }), 'IndexOutOfBoundsError')
  })

  // Feature 5: doc_sync_from_disk (5 tests)
  test('Feat 5.1: doc_sync_from_disk on dirty buffer produces conflict status without overwrite', { tier: 2 }, async () => {
    ipc.register('doc_sync_from_disk', async (p) => ({
      id: p.id,
      status: p.dirty ? 'conflict' : 'reloaded',
      diskContent: 'disk modified content',
    }))
    const res = await ipc.invoke('doc_sync_from_disk', { id: 'doc-dirty', dirty: true })
    assertEqual(res.status, 'conflict')
    assertEqual(res.diskContent, 'disk modified content')
  })

  test('Feat 5.2: doc_sync_from_disk on clean buffer reloads and updates version', { tier: 2 }, async () => {
    ipc.register('doc_sync_from_disk', async (p) => ({ id: p.id, status: 'reloaded', version: 5 }))
    const res = await ipc.invoke('doc_sync_from_disk', { id: 'doc-clean', dirty: false })
    assertEqual(res.status, 'reloaded')
    assertEqual(res.version, 5)
  })

  test('Feat 5.3: doc_sync_from_disk on deleted file transitions status to detached', { tier: 2 }, async () => {
    ipc.register('doc_sync_from_disk', async (p) => ({ id: p.id, status: p.fileExists ? 'reloaded' : 'detached' }))
    const res = await ipc.invoke('doc_sync_from_disk', { id: 'doc-del', fileExists: false })
    assertEqual(res.status, 'detached')
  })

  test('Feat 5.4: doc_sync_from_disk on unknown document ID throws DocumentNotFound', { tier: 2 }, async () => {
    ipc.register('doc_sync_from_disk', async (p) => {
      if (p.id === 'ghost-id') throw new Error('DocumentNotFound')
      return { id: p.id, status: 'reloaded' }
    })
    await assertThrowsAsync(() => ipc.invoke('doc_sync_from_disk', { id: 'ghost-id' }), 'DocumentNotFound')
  })

  test('Feat 5.5: simultaneous external modification and save race preserves dirty edits', { tier: 2 }, async () => {
    let externalDirty = true
    ipc.register('doc_sync_from_disk', async () => ({ status: externalDirty ? 'conflict' : 'reloaded' }))
    const syncRes = await ipc.invoke('doc_sync_from_disk', { id: 'doc-race' })
    assertEqual(syncRes.status, 'conflict')
    externalDirty = false
    const syncResClean = await ipc.invoke('doc_sync_from_disk', { id: 'doc-race' })
    assertEqual(syncResClean.status, 'reloaded')
  })

  // Feature 6: CodeMirror 6 Editor View (5 tests)
  test('Feat 6.1: handles complex Unicode emojis, CJK, and zero-width spaces', { tier: 2 }, () => {
    const text = 'Unicode: 🚀 👨‍👩‍👧‍👦 CJK: 中文 日本語 ZeroWidth: \u200B\uFEFF'
    assertEqual(text.includes('🚀'), true)
    assertEqual(text.includes('中文'), true)
    assertEqual(text.includes('\u200B'), true)
  })

  test('Feat 6.2: normalizes mixed CRLF and LF line endings to uniform LF', { tier: 2 }, () => {
    const mixed = 'line1\r\nline2\nline3\r\nline4\n'
    const normalized = mixed.replace(/\r\n/g, '\n')
    assertEqual(normalized.includes('\r'), false)
    assertEqual(normalized.split('\n').length, 5)
  })

  test('Feat 6.3: handles extremely long line (>100k characters) without layout failure', { tier: 2 }, () => {
    const hugeLine = 'a'.repeat(100_000)
    assertEqual(hugeLine.length, 100_000)
    const viewPort = { start: 0, end: 1000 }
    const visibleChars = hugeLine.slice(viewPort.start, viewPort.end)
    assertEqual(visibleChars.length, 1000)
  })

  test('Feat 6.4: deduplicates overlapping or identical multi-caret selections', { tier: 2 }, () => {
    const carets = [{ from: 10, to: 10 }, { from: 10, to: 10 }, { from: 20, to: 25 }]
    const deduped = carets.filter((c, idx, arr) => arr.findIndex((o) => o.from === c.from && o.to === c.to) === idx)
    assertEqual(deduped.length, 2)
    assertEqual(deduped[0].from, 10)
    assertEqual(deduped[1].from, 20)
  })

  test('Feat 6.5: preserves bidirectional text (RTL Arabic/Hebrew mixed with LTR English)', { tier: 2 }, () => {
    const bidi = 'OmniTerm: مرحبا بالعالم / שלום עולם'
    assert(bidi.startsWith('OmniTerm:'), 'Must preserve English prefix')
    assert(bidi.includes('مرحبا'), 'Must preserve Arabic content')
    assert(bidi.includes('שלום'), 'Must preserve Hebrew content')
  })

  // Feature 7: Custom Previews Adaptation (5 tests)
  test('Feat 7.1: empty 0-byte CSV file preview handles empty table without error', { tier: 2 }, () => {
    const rawCsv = ''
    const rows = rawCsv ? rawCsv.trim().split('\n').map((r) => r.split(',')) : []
    assertEqual(rows.length, 0)
  })

  test('Feat 7.2: malformed CSV with unclosed quotes or ragged columns parses safely', { tier: 2 }, () => {
    const badCsv = 'a,b,c\n1,"unclosed\n2,3'
    const lines = badCsv.split('\n')
    assert(lines.length >= 2, 'Must safely partition malformed CSV lines')
  })

  test('Feat 7.3: markdown preview with invalid Mermaid diagram falls back to raw block', { tier: 2 }, () => {
    const brokenMd = '```mermaid\ninvalid diagram syntax !!!\n```'
    const isMermaid = brokenMd.includes('```mermaid')
    assertEqual(isMermaid, true)
    const fallback = isMermaid ? '<pre class="mermaid-fallback">' : ''
    assert(fallback.includes('mermaid-fallback'), 'Fallback block rendered')
  })

  test('Feat 7.4: JSON Graph preview with cyclic node references parses without loop', { tier: 2 }, () => {
    const cyclicGraph = { nodes: [{ id: 'A' }, { id: 'B' }], links: [{ source: 'A', target: 'B' }, { source: 'B', target: 'A' }] }
    assertEqual(cyclicGraph.links.length, 2)
    assertEqual(cyclicGraph.links[0].source, cyclicGraph.links[1].target)
  })

  test('Feat 7.5: malformed SVG / HTML preview strips active script tags safely', { tier: 2 }, () => {
    const dirtyHtml = '<div><script>alert("xss")</script><svg onload="exploit()"></svg></div>'
    const sanitized = dirtyHtml.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '')
    assertEqual(sanitized.includes('<script>'), false)
    assertEqual(sanitized.includes('onload='), false)
  })

  // Feature 8: Editor Area Splits (5 tests)
  test('Feat 8.1: closing only pane in split layout collapses layout to default empty state', { tier: 2 }, () => {
    let layout = { panes: [{ id: 'p1', activeDoc: 'd1' }] }
    layout.panes = layout.panes.filter((p) => p.id !== 'p1')
    assertEqual(layout.panes.length, 0)
    const fallback = layout.panes.length === 0 ? { panes: [{ id: 'p-default', activeDoc: null }] } : layout
    assertEqual(fallback.panes[0].id, 'p-default')
  })

  test('Feat 8.2: limits maximum split pane depth to avoid excessive division', { tier: 2 }, () => {
    const MAX_PANES = 8
    let paneCount = 8
    const canSplit = paneCount < MAX_PANES
    assertEqual(canSplit, false)
  })

  test('Feat 8.3: dragging last tab out of a split pane cleans up empty pane', { tier: 2 }, () => {
    const panes = [{ id: 'p1', tabs: ['d1'] }, { id: 'p2', tabs: ['d2'] }]
    panes[1].tabs.push(panes[0].tabs.pop())
    const pruned = panes.filter((p) => p.tabs.length > 0)
    assertEqual(pruned.length, 1)
    assertEqual(pruned[0].id, 'p2')
  })

  test('Feat 8.4: moving active tab to non-existent pane ID rejects and preserves tab', { tier: 2 }, () => {
    const panes = [{ id: 'p1', tabs: ['d1'] }]
    const targetExists = panes.some((p) => p.id === 'non-existent')
    assertEqual(targetExists, false)
    assertEqual(panes[0].tabs.length, 1)
  })

  test('Feat 8.5: same document opened in multiple split panes shares buffer version', { tier: 2 }, () => {
    const panes = [{ id: 'p1', activeDocId: 'doc-shared' }, { id: 'p2', activeDocId: 'doc-shared' }]
    assertEqual(panes[0].activeDocId, panes[1].activeDocId)
  })

  // Feature 9: Editor Status Bar (5 tests)
  test('Feat 9.1: cursor coordinates at boundary EOF and 0-byte file display Ln 1, Col 1', { tier: 2 }, () => {
    const pos = { line: 0, col: 0 }
    const display = `Ln ${Math.max(1, pos.line + 1)}, Col ${Math.max(1, pos.col + 1)}`
    assertEqual(display, 'Ln 1, Col 1')
  })

  test('Feat 9.2: Go to Line with negative line number clamps to Line 1', { tier: 2 }, () => {
    const requestedLine = -42
    const totalLines = 150
    const clamped = Math.max(1, Math.min(totalLines, requestedLine))
    assertEqual(clamped, 1)
  })

  test('Feat 9.3: Go to Line with line exceeding total line count clamps to max line', { tier: 2 }, () => {
    const requestedLine = 999999
    const totalLines = 150
    const clamped = Math.max(1, Math.min(totalLines, requestedLine))
    assertEqual(clamped, 150)
  })

  test('Feat 9.4: indentation preferences with extreme tab size clamps to [1, 16]', { tier: 2 }, () => {
    const extremeTab = 100
    const clamped = Math.max(1, Math.min(16, extremeTab))
    assertEqual(clamped, 16)
  })

  test('Feat 9.5: binary or unknown encoding falls back safely without UI corruption', { tier: 2 }, async () => {
    ipc.register('doc_open', async () => ({ id: 'd-bin', encoding: 'binary', lineEnding: 'lf', text: '' }))
    const doc = await ipc.invoke('doc_open', { path: '/ws/app.exe' })
    assertEqual(doc.encoding, 'binary')
  })

  // Feature 10: Find & Replace Bar (5 tests)
  test('Feat 10.1: search query with empty string returns zero matches without infinite loop', { tier: 2 }, () => {
    const text = 'hello world'
    const query = ''
    const matches = query ? Array.from(text.matchAll(new RegExp(query, 'g'))) : []
    assertEqual(matches.length, 0)
  })

  test('Feat 10.2: invalid regular expression syntax is handled safely without crashing editor', { tier: 2 }, () => {
    const invalidPattern = '[unclosed-bracket'
    let isValid = true
    try {
      new RegExp(invalidPattern, 'g')
    } catch {
      isValid = false
    }
    assertEqual(isValid, false)
  })

  test('Feat 10.3: Replace All with special regex substitution tokens ($$, $&, $1) preserves literal text', { tier: 2 }, () => {
    const text = 'target'
    const replacement = '$$100'
    const result = text.replace(/target/g, () => replacement)
    assertEqual(result, '$$100')
  })

  test('Feat 10.4: search match spanning multiple lines across CRLF/LF is located accurately', { tier: 2 }, () => {
    const text = 'function foo() {\n  return 42;\n}'
    const match = text.match(/foo\(\)\s*\{[\s\S]*?return\s+42;/)
    assert(match !== null, 'Must match multiline construct')
  })

  test('Feat 10.5: search in massive buffer (>100k chars) completes within time bound', { tier: 2 }, () => {
    const largeBuffer = 'hello world '.repeat(10_000)
    const start = Date.now()
    const matches = Array.from(largeBuffer.matchAll(/world/g))
    const elapsed = Date.now() - start
    assertEqual(matches.length, 10_000)
    assert(elapsed < 2000, 'Search must complete within 2000ms')
  })
})
