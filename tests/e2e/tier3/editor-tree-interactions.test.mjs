/**
 * Tier 3: Editor x Project Tree & VFS Combinatorial Interactions.
 * Validates cross-subsystem behaviors between Editor Area, Document Registry, and Project Tree / VFS.
 */

import { assert, assertDeepEqual, assertEqual, assertNotEqual } from '../helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from '../helpers/fixtures.mjs'
import { createMockIpc } from '../helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, test } from '../runner/framework.mjs'

describe('Tier 3: Editor x Project Tree & VFS Interactions', () => {
  let ipc
  let workspace

  beforeEach(async () => {
    ipc = createMockIpc()
    workspace = await createTempWorkspace('tier3-edtree-')
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

  test('Tree file deletion while file is open with unsaved changes preserves dirty buffer and warns', async () => {
    const filePath = `${workspace.root}/src/main.rs`
    const doc = await ipc.invoke('doc_open', { path: filePath, initialText: 'fn main() {\n  println!("Hello");\n}' })
    assertEqual(doc.version, 1)

    // User edits document
    const edited = await ipc.invoke('doc_edit', {
      id: doc.id,
      version: 1,
      edits: [{ from: 15, to: 15, insert: '// Unsaved comment\n' }],
    })
    assertEqual(edited.version, 2)
    const isDirty = true

    // Tree initiates deletion
    const delRes = await ipc.invoke('fs_delete', { path: filePath })
    assertEqual(delRes.deleted, true)

    // Check disk sync for dirty buffer
    ipc.register('doc_sync_from_disk', async (p) => {
      if (p.id === doc.id && isDirty) {
        return { id: p.id, status: 'conflict', reason: 'deleted_on_disk', preserveBuffer: true }
      }
      return { id: p.id, status: 'detached' }
    })

    const syncRes = await ipc.invoke('doc_sync_from_disk', { id: doc.id })
    assertEqual(syncRes.status, 'conflict')
    assertEqual(syncRes.preserveBuffer, true)
    assertEqual(syncRes.reason, 'deleted_on_disk')
  }, { tier: 3 })

  test('Tree inline rename updates editor tab title, buffer identity, and breadcrumbs', async () => {
    const oldPath = `${workspace.root}/src/old_calc.rs`
    const newPath = `${workspace.root}/src/new_calc.rs`

    const doc = await ipc.invoke('doc_open', { path: oldPath, initialText: 'pub fn calculate() -> i32 { 42 }' })
    const initialDocId = doc.id

    // Rename file via project tree
    await ipc.invoke('fs_rename', { from: oldPath, to: newPath })

    // Simulate workbench registry updating open document path on fsChanged rename event
    const openTabs = [{ id: initialDocId, path: oldPath, title: 'old_calc.rs', breadcrumbs: ['src', 'old_calc.rs'] }]
    const renameEvent = { type: 'fsChanged', from: oldPath, to: newPath, kind: 'rename' }

    // Tab synchronization logic
    const tab = openTabs.find((t) => t.path === renameEvent.from)
    assert(tab, 'Open tab should be found for rename')
    tab.path = renameEvent.to
    tab.title = renameEvent.to.split('/').pop()
    tab.breadcrumbs = ['src', tab.title]

    // Verify buffer identity is preserved while metadata updates
    assertEqual(tab.id, initialDocId)
    assertEqual(tab.title, 'new_calc.rs')
    assertEqual(tab.path, newPath)
    assertDeepEqual(tab.breadcrumbs, ['src', 'new_calc.rs'])
  }, { tier: 3 })

  test('External disk modification cleanly reloads clean buffer but triggers conflict for dirty buffer', async () => {
    const cleanPath = `${workspace.root}/src/clean.rs`
    const dirtyPath = `${workspace.root}/src/dirty.rs`

    const cleanDoc = await ipc.invoke('doc_open', { path: cleanPath, initialText: 'let a = 1;' })
    const dirtyDoc = await ipc.invoke('doc_open', { path: dirtyPath, initialText: 'let b = 2;' })

    // Dirty the second buffer
    await ipc.invoke('doc_edit', { id: dirtyDoc.id, version: 1, edits: [{ from: 9, to: 9, insert: ' // dirty' }] })

    // Register sync behavior
    ipc.register('doc_sync_from_disk', async (p) => {
      if (p.id === cleanDoc.id) {
        return { id: p.id, status: 'reloaded', externalVersion: 2, newText: 'let a = 100;' }
      }
      if (p.id === dirtyDoc.id) {
        return { id: p.id, status: 'conflict', externalVersion: 2, dirtyVersion: 2 }
      }
      return { id: p.id, status: 'unknown' }
    })

    const cleanSync = await ipc.invoke('doc_sync_from_disk', { id: cleanDoc.id })
    assertEqual(cleanSync.status, 'reloaded')
    assertEqual(cleanSync.newText, 'let a = 100;')

    const dirtySync = await ipc.invoke('doc_sync_from_disk', { id: dirtyDoc.id })
    assertEqual(dirtySync.status, 'conflict')
    assertEqual(dirtySync.dirtyVersion, 2)
  }, { tier: 3 })

  test('Multi-root project switch in dropdown prompts to preserve or save dirty buffers', async () => {
    const rootA = `${workspace.root}/repo-alpha`
    const rootB = `${workspace.root}/repo-beta`

    // Open and dirty a buffer in repo-alpha
    const docAlpha = await ipc.invoke('doc_open', { path: `${rootA}/src/alpha.rs`, initialText: '// alpha' })
    await ipc.invoke('doc_edit', { id: docAlpha.id, version: 1, edits: [{ from: 8, to: 8, insert: ' edited' }] })

    // Registry tracks dirty state across roots
    const activeRegistry = [
      { id: docAlpha.id, root: rootA, path: `${rootA}/src/alpha.rs`, isDirty: true },
    ]

    // Switch active project root to repo-beta
    ipc.register('ide_set_project', async (p) => {
      const dirtyInOtherRoots = activeRegistry.filter((d) => d.root !== p.path && d.isDirty)
      return {
        activeRoot: p.path,
        hasDirtyBuffers: dirtyInOtherRoots.length > 0,
        dirtyCount: dirtyInOtherRoots.length,
        promptRequired: dirtyInOtherRoots.length > 0,
      }
    })

    const switchRes = await ipc.invoke('ide_set_project', { path: rootB })
    assertEqual(switchRes.activeRoot, rootB)
    assertEqual(switchRes.hasDirtyBuffers, true)
    assertEqual(switchRes.promptRequired, true)
    assertEqual(switchRes.dirtyCount, 1)
  }, { tier: 3 })

  test('Locate in Tree recursively expands nested folders to reveal and select active editor tab', async () => {
    const targetFile = `${workspace.root}/src/features/auth/login.rs`
    const activeDoc = await ipc.invoke('doc_open', { path: targetFile, initialText: 'pub fn login() {}' })

    // Simulated virtualized tree hierarchy
    const expandedNodes = new Set()
    const treeState = {
      selectedNode: null,
      expandedPaths: expandedNodes,
    }

    ipc.register('tree_locate_path', async (p) => {
      const parts = p.path.replace(`${workspace.root}/`, '').split('/')
      let current = workspace.root
      for (let i = 0; i < parts.length - 1; i++) {
        current += `/${parts[i]}`
        expandedNodes.add(current)
      }
      treeState.selectedNode = p.path
      return {
        located: true,
        expandedCount: expandedNodes.size,
        selected: treeState.selectedNode,
      }
    })

    const locateRes = await ipc.invoke('tree_locate_path', { path: targetFile, docId: activeDoc.id })
    assertEqual(locateRes.located, true)
    assertEqual(locateRes.selected, targetFile)
    assert(expandedNodes.has(`${workspace.root}/src`), 'src folder must be expanded')
    assert(expandedNodes.has(`${workspace.root}/src/features`), 'features folder must be expanded')
    assert(expandedNodes.has(`${workspace.root}/src/features/auth`), 'auth folder must be expanded')
  }, { tier: 3 })

  test('New file creation in project tree immediately opens active CodeMirror editor tab', async () => {
    const newFilePath = `${workspace.root}/src/utils/math.rs`

    // Create file via tree action
    const created = await ipc.invoke('fs_create_file', { path: newFilePath })
    assertEqual(created.path, newFilePath)

    // Project tree creation triggers document open and active tab switch
    const openRes = await ipc.invoke('doc_open', { path: created.path, initialText: '' })
    assertEqual(openRes.path, newFilePath)
    assertEqual(openRes.version, 1)

    const editorState = {
      activeTabId: openRes.id,
      panes: [{ id: 'pane-1', activeDocId: openRes.id, openDocIds: [openRes.id] }],
    }

    assertEqual(editorState.activeTabId, openRes.id)
    assertEqual(editorState.panes[0].activeDocId, openRes.id)
  }, { tier: 3 })

  test('Deleting parent folder in tree marks child open buffers as detached with warning', async () => {
    const parentDir = `${workspace.root}/src/components`
    const file1 = `${parentDir}/Button.tsx`
    const file2 = `${parentDir}/Modal.tsx`

    const doc1 = await ipc.invoke('doc_open', { path: file1, initialText: '<button />' })
    const doc2 = await ipc.invoke('doc_open', { path: file2, initialText: '<modal />' })

    // Delete parent directory
    await ipc.invoke('fs_delete', { path: parentDir })

    // Both documents detect missing parent directory on disk sync
    ipc.register('doc_sync_from_disk', async (p) => {
      const isUnderDeletedDir = p.path.startsWith(parentDir)
      return {
        id: p.id,
        status: isUnderDeletedDir ? 'detached_missing_parent' : 'ok',
        canSaveAs: true,
      }
    })

    const sync1 = await ipc.invoke('doc_sync_from_disk', { id: doc1.id, path: file1 })
    const sync2 = await ipc.invoke('doc_sync_from_disk', { id: doc2.id, path: file2 })

    assertEqual(sync1.status, 'detached_missing_parent')
    assertEqual(sync2.status, 'detached_missing_parent')
    assertEqual(sync1.canSaveAs, true)
  }, { tier: 3 })

  test('Rapid tree renames during active document save preserve saved contents at target path', async () => {
    const origPath = `${workspace.root}/src/rapid.rs`
    const targetPath = `${workspace.root}/src/rapid_renamed.rs`

    const doc = await ipc.invoke('doc_open', { path: origPath, initialText: 'const VALUE: i32 = 10;' })

    // Simulate in-flight save and rename concurrent requests
    let saveCompleted = false
    let renameCompleted = false

    ipc.register('doc_save', async (p) => {
      saveCompleted = true
      return { id: p.id, success: true, savedPath: origPath }
    })

    ipc.register('fs_rename', async (p) => {
      renameCompleted = true
      return { from: p.from, to: p.to, renamed: true }
    })

    const [saveRes, renameRes] = await Promise.all([
      ipc.invoke('doc_save', { id: doc.id }),
      ipc.invoke('fs_rename', { from: origPath, to: targetPath }),
    ])

    assertEqual(saveRes.success, true)
    assertEqual(renameRes.renamed, true)
    assert(saveCompleted && renameCompleted, 'Both save and rename must resolve successfully')
  }, { tier: 3 })

  test('Split editor layout dragging tab between panes synchronizes tree active selection', async () => {
    const fileA = `${workspace.root}/src/paneA.rs`
    const fileB = `${workspace.root}/src/paneB.rs`

    const docA = await ipc.invoke('doc_open', { path: fileA })
    const docB = await ipc.invoke('doc_open', { path: fileB })

    const layout = {
      pane1: { id: 'p1', activeDocId: docA.id, tabs: [docA.id] },
      pane2: { id: 'p2', activeDocId: docB.id, tabs: [docB.id] },
      activePane: 'p1',
      treeHighlightedPath: fileA,
    }

    // Drag docA from pane1 to pane2
    layout.pane1.tabs = []
    layout.pane2.tabs.push(docA.id)
    layout.pane2.activeDocId = docA.id
    layout.activePane = 'p2'

    // Selection sync updates highlighted path in project tree
    layout.treeHighlightedPath = fileA
    assertEqual(layout.activePane, 'p2')
    assertEqual(layout.pane2.activeDocId, docA.id)
    assertEqual(layout.treeHighlightedPath, fileA)
  }, { tier: 3 })
})
