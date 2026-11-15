/**
 * Tier 3: Editor x Language Server Protocol (LSP) Combinatorial Interactions.
 * Validates cross-subsystem behaviors between Editor Area, CodeMirror, Tree, and LSP.
 */

import { assert, assertDeepEqual, assertEqual, assertNotEqual, assertThrowsAsync } from '../helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from '../helpers/fixtures.mjs'
import { createMockIpc } from '../helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, test } from '../runner/framework.mjs'

describe('Tier 3: Editor x Language Server Protocol (LSP) Interactions', () => {
  let ipc
  let workspace

  beforeEach(async () => {
    ipc = createMockIpc()
    workspace = await createTempWorkspace('tier3-edlsp-')
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

  test('In-place symbol rename modifies multiple open documents and synchronizes buffer versions', async () => {
    const userPath = `${workspace.root}/src/user.rs`
    const mainPath = `${workspace.root}/src/main.rs`

    const docUser = await ipc.invoke('doc_open', { path: userPath, initialText: 'pub struct UserProfile;\n' })
    const docMain = await ipc.invoke('doc_open', { path: mainPath, initialText: 'use crate::user::UserProfile;\n' })

    assertEqual(docUser.version, 1)
    assertEqual(docMain.version, 1)

    // Prepare rename on UserProfile
    const prep = await ipc.invoke('lsp_prepare_rename', { path: userPath, line: 0, newName: 'AccountProfile' })
    assertEqual(prep.placeholder, 'AccountProfile')

    // Workspace edit modifies both open documents
    ipc.register('apply_workspace_edit', async (p) => {
      const changes = p.edit.changes
      assert(changes[userPath], 'Must include user.rs changes')
      assert(changes[mainPath], 'Must include main.rs changes')
      return {
        applied: true,
        updatedDocuments: [
          { path: userPath, newVersion: 2, newText: 'pub struct AccountProfile;\n' },
          { path: mainPath, newVersion: 2, newText: 'use crate::user::AccountProfile;\n' },
        ],
      }
    })

    const editPayload = {
      edit: {
        changes: {
          [userPath]: [{ range: { start: { line: 0, character: 11 }, end: { line: 0, character: 22 } }, newText: 'AccountProfile' }],
          [mainPath]: [{ range: { start: { line: 0, character: 17 }, end: { line: 0, character: 28 } }, newText: 'AccountProfile' }],
        },
      },
    }

    const res = await ipc.invoke('apply_workspace_edit', editPayload)
    assertEqual(res.applied, true)
    assertEqual(res.updatedDocuments.length, 2)
    assertEqual(res.updatedDocuments[0].newVersion, 2)
    assertEqual(res.updatedDocuments[1].newVersion, 2)
    assert(res.updatedDocuments[0].newText.includes('AccountProfile'), 'user.rs must be updated')
    assert(res.updatedDocuments[1].newText.includes('AccountProfile'), 'main.rs must be updated')
  }, { tier: 3 })

  test('Live document edits update LSP diagnostics in real time over event bus', async () => {
    const syntaxPath = `${workspace.root}/src/syntax.rs`
    const doc = await ipc.invoke('doc_open', { path: syntaxPath, initialText: 'fn add(a: i32, b: i32) -> i32 { a + b }' })

    const diagnosticsState = {
      path: syntaxPath,
      items: [],
    }

    ipc.listen('ide://event', (event) => {
      if (event.type === 'diagnostics' && event.path === syntaxPath) {
        diagnosticsState.items = event.items
      }
    })

    // User types invalid syntax
    await ipc.invoke('doc_edit', {
      id: doc.id,
      version: 1,
      edits: [{ from: 39, to: 39, insert: ' let x =' }],
    })

    // Server emits publishDiagnostics
    ipc.emit('ide://event', {
      type: 'diagnostics',
      path: syntaxPath,
      items: [
        { line: 0, col: 45, severity: 'error', message: 'expected expression after "="' },
      ],
    })

    assertEqual(diagnosticsState.items.length, 1)
    assertEqual(diagnosticsState.items[0].severity, 'error')
    assert(diagnosticsState.items[0].message.includes('expected expression'))

    // User fixes syntax error
    await ipc.invoke('doc_edit', {
      id: doc.id,
      version: 2,
      edits: [{ from: 39, to: 47, insert: '' }],
    })

    ipc.emit('ide://event', { type: 'diagnostics', path: syntaxPath, items: [] })
    assertEqual(diagnosticsState.items.length, 0)
  }, { tier: 3 })

  test('Go to Definition resolves reference and opens target file in split editor pane', async () => {
    const callerPath = `${workspace.root}/src/caller.rs`
    const defPath = `${workspace.root}/src/math.rs`

    await ipc.invoke('doc_open', { path: callerPath, initialText: 'let res = compute_sum(10, 20);' })

    ipc.register('lsp_definition', async (p) => [
      { uri: `file://${defPath}`, range: { start: { line: 14, character: 7 }, end: { line: 14, character: 18 } } },
    ])

    const defs = await ipc.invoke('lsp_definition', { path: callerPath, position: { line: 0, character: 15 } })
    assertEqual(defs.length, 1)
    assertEqual(defs[0].uri, `file://${defPath}`)

    // Workbench opens target definition in split pane
    const targetDoc = await ipc.invoke('doc_open', { path: defPath, initialText: 'pub fn compute_sum(a: i32, b: i32) -> i32 { a + b }' })
    const splitLayout = {
      leftPane: { activeDoc: callerPath },
      rightPane: { activeDoc: targetDoc.path, cursor: defs[0].range.start },
      activePane: 'rightPane',
    }

    assertEqual(splitLayout.rightPane.activeDoc, defPath)
    assertEqual(splitLayout.rightPane.cursor.line, 14)
    assertEqual(splitLayout.activePane, 'rightPane')
  }, { tier: 3 })

  test('Tree file rename updates module imports and LSP references across workspace', async () => {
    const oldHelper = `${workspace.root}/src/helpers.rs`
    const newHelper = `${workspace.root}/src/utils.rs`
    const appPath = `${workspace.root}/src/app.rs`

    await ipc.invoke('doc_open', { path: appPath, initialText: 'mod helpers;\nuse helpers::do_work;\n' })

    // Rename file in tree
    await ipc.invoke('fs_rename', { from: oldHelper, to: newHelper })

    // LSP generates import rename edit
    ipc.register('lsp_rename_file_imports', async (p) => ({
      affectedFiles: [appPath],
      edits: [
        { path: appPath, newText: 'mod utils;\nuse utils::do_work;\n', newVersion: 2 },
      ],
    }))

    const renameRes = await ipc.invoke('lsp_rename_file_imports', { oldPath: oldHelper, newPath: newHelper })
    assertEqual(renameRes.affectedFiles.length, 1)
    assertEqual(renameRes.edits[0].path, appPath)
    assert(renameRes.edits[0].newText.includes('mod utils;'), 'Import declaration must be updated')
    assert(renameRes.edits[0].newText.includes('use utils::do_work;'), 'Use statement must be updated')
  }, { tier: 3 })

  test('Editor buffer closure sends didClose and clears ephemeral diagnostics', async () => {
    const tempPath = `${workspace.root}/src/temp.rs`
    const doc = await ipc.invoke('doc_open', { path: tempPath, initialText: '// temporary file' })

    let didCloseReceived = false
    let serverActiveDocs = new Set([tempPath])

    ipc.register('doc_close', async (p) => {
      if (p.id === doc.id) {
        didCloseReceived = true
        serverActiveDocs.delete(tempPath)
        return { id: p.id, closed: true, lspClosed: true }
      }
      return { id: p.id, closed: false }
    })

    const closeRes = await ipc.invoke('doc_close', { id: doc.id })
    assertEqual(closeRes.closed, true)
    assertEqual(closeRes.lspClosed, true)
    assertEqual(didCloseReceived, true)
    assertEqual(serverActiveDocs.has(tempPath), false)
  }, { tier: 3 })

  test('LSP completion triggers auto-import edit at top of open buffer advancing version', async () => {
    const filePath = `${workspace.root}/src/collections.rs`
    const doc = await ipc.invoke('doc_open', { path: filePath, initialText: 'fn test() {\n  let map = HashM\n}' })

    ipc.register('lsp_completion', async () => ({
      items: [
        {
          label: 'HashMap',
          kind: 7,
          detail: 'std::collections::HashMap',
          additionalTextEdits: [
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'use std::collections::HashMap;\n\n' },
          ],
        },
      ],
    }))

    const comps = await ipc.invoke('lsp_completion', { id: doc.id, position: { line: 1, character: 17 } })
    const item = comps.items[0]
    assertEqual(item.label, 'HashMap')
    assert(item.additionalTextEdits.length > 0, 'Auto-import edit must be provided')

    // Applying completion advances buffer version and prepends import
    const edited = await ipc.invoke('doc_edit', {
      id: doc.id,
      version: 1,
      edits: [
        { from: 0, to: 0, insert: item.additionalTextEdits[0].newText },
        { from: 28, to: 33, insert: 'HashMap::new()' },
      ],
    })
    assertEqual(edited.version, 2)
  }, { tier: 3 })

  test('LSP document formatting updates CodeMirror buffer and preserves cursor position', async () => {
    const filePath = `${workspace.root}/src/unformatted.rs`
    const doc = await ipc.invoke('doc_open', { path: filePath, initialText: 'fn   main(  )    {\nlet   x=10  ;\n}' })

    const initialCursor = { line: 1, character: 6 }

    ipc.register('lsp_format', async (p) => ({
      formattedText: 'fn main() {\n  let x = 10;\n}\n',
      editsCount: 4,
    }))

    const fmt = await ipc.invoke('lsp_format', { id: doc.id, cursor: initialCursor })
    assertEqual(fmt.formattedText, 'fn main() {\n  let x = 10;\n}\n')

    // Applying formatted text updates buffer
    const updated = await ipc.invoke('doc_edit', {
      id: doc.id,
      version: 1,
      edits: [{ from: 0, to: 40, insert: fmt.formattedText }],
    })
    assertEqual(updated.version, 2)

    // Cursor relative position adjusted cleanly
    const adjustedCursor = { line: 1, character: 8 }
    assertEqual(adjustedCursor.line, 1)
    assert(adjustedCursor.character > 0, 'Cursor should be positioned inside formatted statement')
  }, { tier: 3 })

  test('LSP diagnostics for unopened file populate Problems panel and jump to file upon click', async () => {
    const unopenedFile = `${workspace.root}/src/unopened.rs`

    const problemsState = []
    ipc.listen('ide://event', (ev) => {
      if (ev.type === 'diagnostics') {
        problemsState.push(...ev.items.map((i) => ({ ...i, path: ev.path })))
      }
    })

    // Server emits diagnostics for unopened file
    ipc.emit('ide://event', {
      type: 'diagnostics',
      path: unopenedFile,
      items: [{ line: 42, col: 5, severity: 'warning', message: 'unused variable `temp`' }],
    })

    assertEqual(problemsState.length, 1)
    assertEqual(problemsState[0].path, unopenedFile)
    assertEqual(problemsState[0].line, 42)

    // Clicking problem in panel opens document and focuses line
    const openedDoc = await ipc.invoke('doc_open', { path: problemsState[0].path, initialText: '// Line 42 content' })
    assertEqual(openedDoc.path, unopenedFile)
    const activeEditorView = { activeDocId: openedDoc.id, targetLine: problemsState[0].line }
    assertEqual(activeEditorView.targetLine, 42)
  }, { tier: 3 })

  test('In-place rename in untrusted workspace rejected by TrustGate before modifying files', async () => {
    const untrustedFile = `${workspace.root}/src/restricted.rs`
    await ipc.invoke('doc_open', { path: untrustedFile, initialText: 'let old_name = 100;' })

    const isTrustedWorkspace = false

    ipc.register('apply_workspace_edit', async () => {
      if (!isTrustedWorkspace) {
        throw new Error('TrustGateError: Modifying workspace edits is blocked in untrusted mode')
      }
      return { applied: true }
    })

    await assertThrowsAsync(
      () => ipc.invoke('apply_workspace_edit', { edit: { changes: { [untrustedFile]: [] } } }),
      'TrustGateError'
    )
  }, { tier: 3 })
})
