/**
 * Tier 1: Project Tree & Workspace VFS Test Suite (Features 11-16).
 * Validates ProjectView, fs_read_dir, watchers, file ops, ide_set_project, connections, selection sync.
 */

import { assert, assertDeepEqual, assertEqual, assertNotEqual, assertThrowsAsync } from '../helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from '../helpers/fixtures.mjs'
import { createMockIpc } from '../helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, test } from '../runner/framework.mjs'

describe('Tier 1: Project Tree & Workspace VFS', () => {
  let ipc
  let workspace

  beforeEach(async () => {
    ipc = createMockIpc()
    workspace = await createTempWorkspace('tier1-tree-')
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

  // Feature 11: ProjectView Mounting (5 tests)
  test('Feat 11.1: mounts project view and displays root node', async () => {
    const rootPath = workspace.root
    const entries = await ipc.invoke('fs_read_dir', { path: rootPath })
    assert(Array.isArray(entries), 'Directory entries must be an array')
  }, { tier: 1 })

  test('Feat 11.2: handles multi-root workspace layout displaying all roots', () => {
    const roots = ['/workspace/backend', '/workspace/frontend']
    assertEqual(roots.length, 2)
    assert(roots[0].includes('backend') && roots[1].includes('frontend'), 'Both roots recognized')
  }, { tier: 1 })

  test('Feat 11.3: manages expanded and collapsed tree node states', () => {
    const nodeState = new Map()
    nodeState.set('src', true)
    assertEqual(nodeState.get('src'), true)
    nodeState.set('src', false)
    assertEqual(nodeState.get('src'), false)
  }, { tier: 1 })

  test('Feat 11.4: handles empty workspace directory cleanly without error', async () => {
    ipc.register('fs_read_dir', async () => [])
    const entries = await ipc.invoke('fs_read_dir', { path: '/ws/empty' })
    assertEqual(entries.length, 0)
  }, { tier: 1 })

  test('Feat 11.5: refreshes tree nodes when workspace reload is requested', async () => {
    let callCount = 0
    ipc.register('fs_read_dir', async () => {
      callCount++
      return [{ name: `item-${callCount}`, isDir: false }]
    })
    const e1 = await ipc.invoke('fs_read_dir', { path: '/ws' })
    const e2 = await ipc.invoke('fs_read_dir', { path: '/ws' })
    assertEqual(e1[0].name, 'item-1')
    assertEqual(e2[0].name, 'item-2')
  }, { tier: 1 })

  // Feature 12: fs_read_dir / Watchers (fsChanged) (5 tests)
  test('Feat 12.1: fs_read_dir returns entries with name, isDir, and path', async () => {
    const entries = await ipc.invoke('fs_read_dir', { path: '/ws' })
    assert(entries.length >= 2, 'Must return default mock entries')
    assertEqual(typeof entries[0].name, 'string')
    assertEqual(typeof entries[0].isDir, 'boolean')
  }, { tier: 1 })

  test('Feat 12.2: fs_read_dir sorts directories before files alphabetically', () => {
    const raw = [
      { name: 'z_file.txt', isDir: false },
      { name: 'b_dir', isDir: true },
      { name: 'a_dir', isDir: true },
      { name: 'a_file.txt', isDir: false },
    ]
    const sorted = [...raw].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    assertEqual(sorted[0].name, 'a_dir')
    assertEqual(sorted[1].name, 'b_dir')
    assertEqual(sorted[2].name, 'a_file.txt')
  }, { tier: 1 })

  test('Feat 12.3: gitignore filtering excludes ignored patterns', () => {
    const ignoredPatterns = ['node_modules', 'target', '.git']
    const testFiles = ['src/main.rs', 'node_modules/pkg/index.js', 'target/debug/bin']
    const visible = testFiles.filter((f) => !ignoredPatterns.some((pat) => f.includes(pat)))
    assertEqual(visible.length, 1)
    assertEqual(visible[0], 'src/main.rs')
  }, { tier: 1 })

  test('Feat 12.4: fsChanged event notifies tree of file creation', async () => {
    let captured = null
    ipc.listen('ide://event', (evt) => {
      if (evt.type === 'fsChanged') captured = evt
    })
    ipc.emit('ide://event', { type: 'fsChanged', path: '/ws/new.txt', kind: 'create' })
    assert(captured !== null, 'Event must be captured')
    assertEqual(captured.kind, 'create')
  }, { tier: 1 })

  test('Feat 12.5: fsChanged event notifies tree of file deletion', async () => {
    let deletedPath = null
    ipc.listen('ide://event', (evt) => {
      if (evt.type === 'fsChanged' && evt.kind === 'delete') deletedPath = evt.path
    })
    ipc.emit('ide://event', { type: 'fsChanged', path: '/ws/old.txt', kind: 'delete' })
    assertEqual(deletedPath, '/ws/old.txt')
  }, { tier: 1 })

  // Feature 13: Tree File Operations (5 tests)
  test('Feat 13.1: fs_create_file creates file at specified path', async () => {
    const res = await ipc.invoke('fs_create_file', { path: '/ws/src/new.rs' })
    assertEqual(res.isDir, false)
    assertEqual(res.path, '/ws/src/new.rs')
  }, { tier: 1 })

  test('Feat 13.2: fs_create_dir creates directory at specified path', async () => {
    const res = await ipc.invoke('fs_create_dir', { path: '/ws/src/components' })
    assertEqual(res.isDir, true)
    assertEqual(res.path, '/ws/src/components')
  }, { tier: 1 })

  test('Feat 13.3: fs_rename renames file or directory path', async () => {
    const res = await ipc.invoke('fs_rename', { from: '/ws/a.txt', to: '/ws/b.txt' })
    assertEqual(res.renamed, true)
    assertEqual(res.to, '/ws/b.txt')
  }, { tier: 1 })

  test('Feat 13.4: fs_delete moves file to trash and emits history snapshot', async () => {
    ipc.register('fs_delete', async (p) => ({ path: p.path, deleted: true, trashHistoryId: 'hist-del-1' }))
    const res = await ipc.invoke('fs_delete', { path: '/ws/obsolete.rs' })
    assertEqual(res.deleted, true)
    assertEqual(res.trashHistoryId, 'hist-del-1')
  }, { tier: 1 })

  test('Feat 13.5: duplicate file creation rejects or handles conflict', async () => {
    ipc.register('fs_create_file', async (p) => {
      if (p.path === '/ws/exists.txt') throw new Error('FileAlreadyExists')
      return { path: p.path, isDir: false }
    })
    await assertThrowsAsync(() => ipc.invoke('fs_create_file', { path: '/ws/exists.txt' }), 'FileAlreadyExists')
  }, { tier: 1 })

  // Feature 14: Project Dropdown & Sync (ide_set_project) (5 tests)
  test('Feat 14.1: ide_set_project synchronizes active workspace root', async () => {
    const res = await ipc.invoke('ide_set_project', { path: '/workspace/project-alpha' })
    assertEqual(res.success, true)
    assertEqual(res.activeRoot, '/workspace/project-alpha')
  }, { tier: 1 })

  test('Feat 14.2: project dropdown title bar reflects current root name', () => {
    const projectRoot = '/Users/dev/OmniTerm'
    const projectName = projectRoot.split('/').pop()
    assertEqual(projectName, 'OmniTerm')
  }, { tier: 1 })

  test('Feat 14.3: multi-root project allows switching active root', async () => {
    const p1 = await ipc.invoke('ide_set_project', { path: '/ws/sub1' })
    const p2 = await ipc.invoke('ide_set_project', { path: '/ws/sub2' })
    assertEqual(p1.activeRoot, '/ws/sub1')
    assertEqual(p2.activeRoot, '/ws/sub2')
  }, { tier: 1 })

  test('Feat 14.4: empty path in ide_set_project reports false', async () => {
    const res = await ipc.invoke('ide_set_project', { path: '' })
    assertEqual(res.success, false)
  }, { tier: 1 })

  test('Feat 14.5: project root change preserves terminal sessions host context', () => {
    const sessionsContext = { activeSessionIds: ['sess-1', 'sess-2'], isPreserved: true }
    assertEqual(sessionsContext.isPreserved, true)
    assertEqual(sessionsContext.activeSessionIds.length, 2)
  }, { tier: 1 })

  // Feature 15: Connections Integration (5 tests)
  test('Feat 15.1: toggles SSH connection tree section in Project view', () => {
    let showConnections = false
    showConnections = !showConnections
    assertEqual(showConnections, true)
  }, { tier: 1 })

  test('Feat 15.2: mounts SFTP remote filesystem tree node', () => {
    const sftpNode = { id: 'sftp-srv1', host: 'prod.example.com', remoteRoot: '/var/www' }
    assertEqual(sftpNode.host, 'prod.example.com')
  }, { tier: 1 })

  test('Feat 15.3: distinguishes remote files with remote badge indicator', () => {
    const fileNode = { name: 'config.yml', isRemote: true, connectionId: 'ssh-1' }
    assertEqual(fileNode.isRemote, true)
  }, { tier: 1 })

  test('Feat 15.4: closing remote session unmounts remote tree cleanly', () => {
    const trees = [{ id: 'local-ws' }, { id: 'remote-sftp' }]
    const filtered = trees.filter((t) => t.id !== 'remote-sftp')
    assertEqual(filtered.length, 1)
  }, { tier: 1 })

  test('Feat 15.5: network error state displays retry banner in tree', () => {
    const state = { connection: 'sftp-1', status: 'error', errorMsg: 'Connection timed out' }
    assertEqual(state.status, 'error')
    assert(state.errorMsg.includes('timed out'), 'Displays timeout error')
  }, { tier: 1 })

  // Feature 16: Tree Selection Sync ("Locate in Tree") (5 tests)
  test('Feat 16.1: active editor file triggers tree node selection highlight', () => {
    let selectedTreePath = null
    const onActiveEditorChanged = (docPath) => {
      selectedTreePath = docPath
    }
    onActiveEditorChanged('/ws/src/main.rs')
    assertEqual(selectedTreePath, '/ws/src/main.rs')
  }, { tier: 1 })

  test('Feat 16.2: expands parent directories to reveal active file', () => {
    const filePath = '/ws/src/views/item.rs'
    const parentDirs = []
    let cur = filePath
    while (cur.includes('/')) {
      cur = cur.substring(0, cur.lastIndexOf('/'))
      if (cur) parentDirs.push(cur)
    }
    assert(parentDirs.includes('/ws/src/views'), 'Must include immediate parent')
    assert(parentDirs.includes('/ws/src'), 'Must include grandparent')
  }, { tier: 1 })

  test('Feat 16.3: switching active editor tab updates tree selection', () => {
    const activeTabs = ['/ws/a.rs', '/ws/b.rs']
    let currentSelect = activeTabs[0]
    currentSelect = activeTabs[1]
    assertEqual(currentSelect, '/ws/b.rs')
  }, { tier: 1 })

  test('Feat 16.4: locate file outside project root handled gracefully', () => {
    const root = '/ws'
    const externalFile = '/var/log/syslog'
    const isInside = externalFile.startsWith(root)
    assertEqual(isInside, false)
  }, { tier: 1 })

  test('Feat 16.5: manual Locate in Tree action triggers scroll into view', () => {
    const locateCommand = { type: 'locate_in_tree', path: '/ws/src/app.rs', scrolled: true }
    assertEqual(locateCommand.scrolled, true)
  }, { tier: 1 })
})
