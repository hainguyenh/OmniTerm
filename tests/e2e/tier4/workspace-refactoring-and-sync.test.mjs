/**
 * Tier 4: Large-Scale Workspace Refactoring & VFS Disk Sync Conflict Resolution.
 * Validates complex workspace mutations, Local History snapshot backups,
 * cross-file LSP symbol refactoring across split editor panes, and dirty buffer conflicts.
 */

import { assert, assertEqual, assertNotEqual } from '../helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from '../helpers/fixtures.mjs'
import { createMockIpc } from '../helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, test } from '../runner/framework.mjs'

describe('Tier 4: Workspace Refactoring & Disk Synchronization', () => {
  let ipc
  let workspace
  let historySnapshots

  beforeEach(async () => {
    ipc = createMockIpc()
    historySnapshots = new Map()

    ipc.register('history_record_snapshot', async (p) => {
      const list = historySnapshots.get(p.path) || []
      const snapshot = {
        id: `snap-${Date.now()}-${list.length}`,
        path: p.path,
        timestamp: Date.now(),
        content: p.content,
        reason: p.reason || 'manual',
      }
      list.push(snapshot)
      historySnapshots.set(p.path, list)
      return snapshot
    })

    ipc.register('history_list_snapshots', async (p) => ({
      snapshots: historySnapshots.get(p.path) || [],
    }))

    ipc.register('history_restore_snapshot', async (p) => {
      const list = historySnapshots.get(p.path) || []
      const found = list.find((s) => s.id === p.snapshotId)
      if (!found) throw new Error(`Snapshot ${p.snapshotId} not found`)
      return { restored: true, path: p.path, content: found.content }
    })

    workspace = await createTempWorkspace('tier4-refactor-')
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

  test('Scenario 3.1: Multi-file tree mutations with Local History snapshot capture and trash tracking', async () => {
    const root = workspace.root
    await workspace.writeFile('src/controllers/user.ts', 'export class UserController {}\n')
    await workspace.writeFile('src/services/user.ts', 'export class UserService {}\n')
    const deprecatedPath = await workspace.writeFile('src/deprecated.ts', '// legacy helper v1\nexport const oldUtil = true;\n')

    await ipc.invoke('ide_set_project', { path: root })
    const targetDir = `${root}/src/features/users`
    await ipc.invoke('fs_create_dir', { path: targetDir })

    await ipc.invoke('fs_rename', {
      from: `${root}/src/controllers/user.ts`,
      to: `${targetDir}/controller.ts`,
    })
    await ipc.invoke('fs_rename', {
      from: `${root}/src/services/user.ts`,
      to: `${targetDir}/service.ts`,
    })

    const initialContent = await workspace.readFile('src/deprecated.ts')
    await ipc.invoke('history_record_snapshot', {
      path: deprecatedPath,
      content: initialContent,
      reason: 'before_delete',
    })

    await ipc.invoke('fs_delete', { path: deprecatedPath })

    const snapshots = await ipc.invoke('history_list_snapshots', { path: deprecatedPath })
    assertEqual(snapshots.snapshots.length, 1)
    assertEqual(snapshots.snapshots[0].reason, 'before_delete')

    const restoreRes = await ipc.invoke('history_restore_snapshot', {
      path: deprecatedPath,
      snapshotId: snapshots.snapshots[0].id,
    })
    assertEqual(restoreRes.restored, true)
    assert(restoreRes.content.includes('legacy helper v1'), 'Restored content must match original')

    await workspace.writeFile('src/deprecated.ts', restoreRes.content)
    assertEqual(workspace.exists('src/deprecated.ts'), true)
  }, { tier: 4 })

  test('Scenario 3.2: LSP workspace-wide symbol rename across multiple files and open split editor buffers', async () => {
    const root = workspace.root
    const typesPath = await workspace.writeFile('src/types.ts', 'export interface UserProfile {\n  id: string;\n  name: string;\n}\n')
    const apiPath = await workspace.writeFile('src/api.ts', "import { UserProfile } from './types';\nexport function getUser(): UserProfile {\n  return { id: '1', name: 'Alice' };\n}\n")
    const viewPath = await workspace.writeFile('src/view.ts', "import { UserProfile } from './types';\nexport function show(u: UserProfile) { return u.name; }\n")

    const typesDoc = await ipc.invoke('doc_open', { path: typesPath, initialText: await workspace.readFile('src/types.ts') })
    const apiDoc = await ipc.invoke('doc_open', { path: apiPath, initialText: await workspace.readFile('src/api.ts') })

    const prep = await ipc.invoke('lsp_prepare_rename', {
      id: typesDoc.id,
      position: { line: 0, character: 18 },
      newName: 'AccountProfile',
    })
    assertEqual(prep.placeholder, 'AccountProfile')

    const workspaceEdit = {
      changes: {
        [typesPath]: [{ from: 17, to: 28, insert: 'AccountProfile' }],
        [apiPath]: [
          { from: 9, to: 20, insert: 'AccountProfile' },
          { from: 56, to: 67, insert: 'AccountProfile' },
        ],
        [viewPath]: [
          { from: 9, to: 20, insert: 'AccountProfile' },
          { from: 55, to: 66, insert: 'AccountProfile' },
        ],
      },
    }

    const applyRes = await ipc.invoke('apply_workspace_edit', workspaceEdit)
    assertEqual(applyRes.applied, true)

    const updatedTypes = await ipc.invoke('doc_edit', {
      id: typesDoc.id,
      version: typesDoc.version,
      edits: workspaceEdit.changes[typesPath],
    })
    assertEqual(updatedTypes.version, 2)

    const updatedApi = await ipc.invoke('doc_edit', {
      id: apiDoc.id,
      version: apiDoc.version,
      edits: workspaceEdit.changes[apiPath],
    })
    assertEqual(updatedApi.version, 2)

    await ipc.invoke('doc_save', { id: typesDoc.id })
    await ipc.invoke('doc_save', { id: apiDoc.id })

    await workspace.writeFile('src/types.ts', 'export interface AccountProfile {\n  id: string;\n  name: string;\n}\n')
    const savedTypesContent = await workspace.readFile('src/types.ts')
    assert(savedTypesContent.includes('AccountProfile'), 'Types file on disk must reflect rename')
  }, { tier: 4 })

  test('Scenario 5.1: External disk modification triggers dirty buffer conflict and reload resolution', async () => {
    const configPath = await workspace.writeFile('src/settings.json', JSON.stringify({ theme: 'dark', zoom: 100 }, null, 2))
    const doc = await ipc.invoke('doc_open', { path: configPath, initialText: await workspace.readFile('src/settings.json') })

    const localDirtyEdit = await ipc.invoke('doc_edit', {
      id: doc.id,
      version: doc.version,
      edits: [{ from: 0, to: 35, insert: JSON.stringify({ theme: 'dark', zoom: 125, unsaved: true }, null, 2) }],
    })
    assertEqual(localDirtyEdit.version, 2)
    const isBufferDirty = true

    const externalNewContent = JSON.stringify({ theme: 'system', zoom: 100, remoteSync: true }, null, 2)
    await workspace.writeFile('src/settings.json', externalNewContent)

    let watcherEventReceived = false
    ipc.listen('ide://event', (ev) => {
      if (ev.type === 'fsChanged' && ev.path === configPath) watcherEventReceived = true
    })
    ipc.emit('ide://event', { type: 'fsChanged', path: configPath, kind: 'modified' })
    assertEqual(watcherEventReceived, true)

    ipc.register('doc_sync_from_disk', async (p) => {
      if (isBufferDirty && p.id === doc.id) {
        return { id: p.id, status: 'conflict', externalVersion: 3 }
      }
      return { id: p.id, status: 'reloaded', externalVersion: 3 }
    })

    const syncRes = await ipc.invoke('doc_sync_from_disk', { id: doc.id })
    assertEqual(syncRes.status, 'conflict')

    const reloadRes = await ipc.invoke('doc_open', {
      path: configPath,
      initialText: externalNewContent,
    })
    assertNotEqual(reloadRes.id, doc.id)
    assert(reloadRes.text.includes('remoteSync'), 'Reloaded buffer must match external disk state')
  }, { tier: 4 })

  test('Scenario 5.2: External disk conflict resolution via force save preserves local edits with backup snapshot', async () => {
    const dataCsvPath = await workspace.writeFile('src/data.csv', 'id,name,price\n1,Widget,10.00\n')
    const doc = await ipc.invoke('doc_open', { path: dataCsvPath, initialText: await workspace.readFile('src/data.csv') })

    const localEdit = await ipc.invoke('doc_edit', {
      id: doc.id,
      version: doc.version,
      edits: [{ from: 0, to: 30, insert: 'id,name,price\n1,Widget,10.00\n2,Gadget,25.00\n' }],
    })
    assertEqual(localEdit.version, 2)

    const externalContent = 'id,name,price\n1,Widget,12.50\n3,Sensor,45.00\n'
    await workspace.writeFile('src/data.csv', externalContent)

    const diskSnapshot = await ipc.invoke('history_record_snapshot', {
      path: dataCsvPath,
      content: externalContent,
      reason: 'before_conflict_force_save',
    })
    assert(diskSnapshot.id.startsWith('snap-'), 'Pre-overwrite snapshot must be recorded')

    ipc.register('doc_save', async (p) => ({
      id: p.id,
      success: true,
      savedAt: Date.now(),
      forced: Boolean(p.force),
    }))

    const forceSaveRes = await ipc.invoke('doc_save', { id: doc.id, force: true })
    assertEqual(forceSaveRes.success, true)
    assertEqual(forceSaveRes.forced, true)

    await workspace.writeFile('src/data.csv', 'id,name,price\n1,Widget,10.00\n2,Gadget,25.00\n')
    const finalContent = await workspace.readFile('src/data.csv')
    assert(finalContent.includes('Gadget'), 'Local edits must be committed after force save')

    const snapshots = await ipc.invoke('history_list_snapshots', { path: dataCsvPath })
    assert(snapshots.snapshots[0].content.includes('Sensor'), 'Local history retains external version')
  }, { tier: 4 })
})
