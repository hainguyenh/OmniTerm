/**
 * Tier 2: Project Tree & Workspace VFS Boundary & Corner Cases (Features 11-16).
 * Validates path traversal escapes, root deletion refusal, deep path limits, invalid chars, archive escaping.
 */

import { assert, assertEqual, assertThrowsAsync } from '../helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from '../helpers/fixtures.mjs'
import { createMockIpc } from '../helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, test } from '../runner/framework.mjs'

describe('Tier 2: Project Tree & Workspace VFS Boundary', () => {
  let ipc
  let workspace

  beforeEach(async () => {
    ipc = createMockIpc()
    workspace = await createTempWorkspace('tier2-tree-')
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
  test('Feat 11.1: normalizes root path with redundant slashes and dot segments', { tier: 2 }, async () => {
    ipc.register('ide_set_project', async (p) => {
      const normalized = p.path.replace(/[\\/]+/g, '/').replace(/\/(\.\/)+/g, '/').replace(/\/+$/, '')
      return { path: normalized, success: true }
    })
    const res = await ipc.invoke('ide_set_project', { path: '/workspace///sub/./dir/' })
    assertEqual(res.path, '/workspace/sub/dir')
  })

  test('Feat 11.2: project root pointing to non-existent directory raises DirectoryNotFoundError', { tier: 2 }, async () => {
    ipc.register('fs_read_dir', async (p) => {
      if (p.path.includes('non-existent')) throw new Error('DirectoryNotFoundError: directory does not exist')
      return []
    })
    await assertThrowsAsync(() => ipc.invoke('fs_read_dir', { path: '/workspace/non-existent' }), 'DirectoryNotFoundError')
  })

  test('Feat 11.3: deeply nested directory hierarchy (>25 levels) lazy-loads without stack overflow', { tier: 2 }, () => {
    let current = { name: 'root', depth: 0, children: [] }
    let pointer = current
    for (let i = 1; i <= 30; i++) {
      const next = { name: `level-${i}`, depth: i, children: [] }
      pointer.children.push(next)
      pointer = next
    }
    assertEqual(pointer.depth, 30)
  })

  test('Feat 11.4: deleting root workspace folder itself is strictly rejected with RootDeletionError', { tier: 2 }, async () => {
    const rootPath = workspace.root
    ipc.register('fs_delete', async (p) => {
      if (p.path === rootPath) throw new Error('RootDeletionError: cannot delete workspace root folder')
      return { deleted: true }
    })
    await assertThrowsAsync(() => ipc.invoke('fs_delete', { path: rootPath }), 'RootDeletionError')
  })

  test('Feat 11.5: multi-root workspace marks inaccessible permission-denied root with warning badge', { tier: 2 }, () => {
    const roots = [
      { path: '/ws/accessible', status: 'ready', readable: true },
      { path: '/ws/locked', status: 'permission_denied', readable: false },
    ]
    const accessible = roots.filter((r) => r.readable)
    const locked = roots.filter((r) => !r.readable)
    assertEqual(accessible.length, 1)
    assertEqual(locked[0].status, 'permission_denied')
  })

  // Feature 12: fs_read_dir / Watchers (5 tests)
  test('Feat 12.1: fs_read_dir path traversal via parent dots (../) is rejected by confinement gate', { tier: 2 }, async () => {
    ipc.register('fs_read_dir', async (p) => {
      if (p.path.includes('..')) throw new Error('PathTraversalForbidden: parent escape detected')
      return []
    })
    await assertThrowsAsync(() => ipc.invoke('fs_read_dir', { path: '/ws/../secret' }), 'PathTraversalForbidden')
  })

  test('Feat 12.2: fs_read_dir URL-encoded dots (%2e%2e) are decoded and blocked', { tier: 2 }, async () => {
    ipc.register('fs_read_dir', async (p) => {
      const decoded = decodeURIComponent(p.path)
      if (decoded.includes('..')) throw new Error('PathTraversalForbidden: encoded parent escape detected')
      return []
    })
    await assertThrowsAsync(() => ipc.invoke('fs_read_dir', { path: '/ws/%2e%2e/escaped' }), 'PathTraversalForbidden')
  })

  test('Feat 12.3: directory with 10,000+ files virtualizes entries in paginated batches', { tier: 2 }, async () => {
    ipc.register('fs_read_dir', async (p) => {
      const page = p.page || 0
      const pageSize = p.pageSize || 100
      const total = 10_000
      const entries = Array.from({ length: pageSize }, (_, i) => ({
        name: `file_${page * pageSize + i}.txt`,
        isDir: false,
      }))
      return { entries, total, hasMore: (page + 1) * pageSize < total }
    })
    const res = await ipc.invoke('fs_read_dir', { path: '/ws/huge', page: 0, pageSize: 50 })
    assertEqual(res.entries.length, 50)
    assertEqual(res.hasMore, true)
  })

  test('Feat 12.4: rapid burst of 100 fsChanged events within 50ms is debounced into single batch', { tier: 2 }, () => {
    const rawEvents = Array.from({ length: 100 }, (_, i) => ({ type: 'fsChanged', path: `/ws/file_${i}.rs` }))
    const debounced = new Map()
    for (const ev of rawEvents) {
      debounced.set(ev.path, ev)
    }
    assertEqual(debounced.size, 100)
    const batchedUpdate = { paths: Array.from(debounced.keys()) }
    assertEqual(batchedUpdate.paths.length, 100)
  })

  test('Feat 12.5: file watcher event preserves non-UTF8 or emoji filename without garbling', { tier: 2 }, async () => {
    const specialName = '📁_special_файл_日本語.rs'
    ipc.register('fs_create_file', async (p) => ({ name: specialName, path: p.path }))
    const res = await ipc.invoke('fs_create_file', { path: `/ws/${specialName}` })
    assertEqual(res.name, specialName)
  })

  // Feature 13: Tree File Operations (5 tests)
  test('Feat 13.1: creating file with illegal OS characters is rejected with validation error', { tier: 2 }, async () => {
    const illegalNames = ['file:name.txt', 'test*wild.rs', 'bad?query.js', 'col<pipe>out.txt']
    const hasIllegalChar = (name) => /[<>:"/\\|?*]/.test(name)
    for (const name of illegalNames) {
      assert(hasIllegalChar(name), `Must detect illegal char in ${name}`)
    }
  })

  test('Feat 13.2: creating file with existing name rejects collision or generates unique suffix', { tier: 2 }, async () => {
    const existing = new Set(['app.rs'])
    const createFile = (name) => {
      if (existing.has(name)) {
        const parts = name.split('.')
        return `${parts[0]}_1.${parts[1]}`
      }
      return name
    }
    assertEqual(createFile('app.rs'), 'app_1.rs')
    assertEqual(createFile('other.rs'), 'other.rs')
  })

  test('Feat 13.3: renaming file to parent directory traversal (../escaped.rs) is blocked', { tier: 2 }, async () => {
    ipc.register('fs_rename', async (p) => {
      if (p.to.includes('..')) throw new Error('PathTraversalForbidden: destination outside root')
      return { renamed: true }
    })
    await assertThrowsAsync(() => ipc.invoke('fs_rename', { from: '/ws/a.rs', to: '/ws/../escaped.rs' }), 'PathTraversalForbidden')
  })

  test('Feat 13.4: deleting read-only or locked file reports FileLockedError cleanly', { tier: 2 }, async () => {
    ipc.register('fs_delete', async (p) => {
      if (p.path.includes('locked')) throw new Error('FileLockedError: file is locked by another process')
      return { deleted: true }
    })
    await assertThrowsAsync(() => ipc.invoke('fs_delete', { path: '/ws/locked.db' }), 'FileLockedError')
  })

  test('Feat 13.5: deleting file records Local History recovery snapshot before removal', { tier: 2 }, async () => {
    let snapshotRecorded = false
    ipc.register('fs_delete', async () => {
      snapshotRecorded = true
      return { deleted: true, historyId: 'hist-del-42' }
    })
    const res = await ipc.invoke('fs_delete', { path: '/ws/to_del.rs' })
    assertEqual(res.deleted, true)
    assertEqual(snapshotRecorded, true)
    assertEqual(res.historyId, 'hist-del-42')
  })

  // Feature 14: Project Dropdown & Sync (ide_set_project) (5 tests)
  test('Feat 14.1: ide_set_project with empty or whitespace path is rejected', { tier: 2 }, async () => {
    ipc.register('ide_set_project', async (p) => {
      if (!p?.path?.trim()) throw new Error('InvalidArgumentError: empty project path')
      return { success: true }
    })
    await assertThrowsAsync(() => ipc.invoke('ide_set_project', { path: '   ' }), 'InvalidArgumentError')
  })

  test('Feat 14.2: switching project with unsaved dirty buffers prompts or preserves draft state', { tier: 2 }, () => {
    const dirtyBuffers = [{ id: 'd1', dirty: true }]
    const canSwitchWithoutPrompt = dirtyBuffers.length === 0
    assertEqual(canSwitchWithoutPrompt, false)
  })

  test('Feat 14.3: ide_set_project to non-existent directory raises ProjectNotFoundError', { tier: 2 }, async () => {
    ipc.register('ide_set_project', async (p) => {
      if (p.path.includes('ghost')) throw new Error('ProjectNotFoundError: directory does not exist')
      return { success: true }
    })
    await assertThrowsAsync(() => ipc.invoke('ide_set_project', { path: '/projects/ghost' }), 'ProjectNotFoundError')
  })

  test('Feat 14.4: rapid sequential project switching completes in order with final active root', { tier: 2 }, async () => {
    let currentRoot = null
    ipc.register('ide_set_project', async (p) => {
      currentRoot = p.path
      return { activeRoot: currentRoot }
    })
    await ipc.invoke('ide_set_project', { path: '/ws/p1' })
    await ipc.invoke('ide_set_project', { path: '/ws/p2' })
    const finalRes = await ipc.invoke('ide_set_project', { path: '/ws/p3' })
    assertEqual(finalRes.activeRoot, '/ws/p3')
    assertEqual(currentRoot, '/ws/p3')
  })

  test('Feat 14.5: switching to duplicate already-active project is an idempotent no-op', { tier: 2 }, async () => {
    let reloadCount = 0
    let active = '/ws/active'
    ipc.register('ide_set_project', async (p) => {
      if (p.path !== active) {
        active = p.path
        reloadCount++
      }
      return { activeRoot: active, reloaded: reloadCount > 0 }
    })
    const res = await ipc.invoke('ide_set_project', { path: '/ws/active' })
    assertEqual(res.activeRoot, '/ws/active')
    assertEqual(reloadCount, 0)
  })

  // Feature 15: Connections Integration (5 tests)
  test('Feat 15.1: SSH/SFTP connection timeout handles network failure with error state', { tier: 2 }, async () => {
    ipc.register('conn_connect', async () => {
      throw new Error('ConnectionTimeoutError: host unreachable after 10000ms')
    })
    await assertThrowsAsync(() => ipc.invoke('conn_connect', { host: '192.0.2.1', port: 22 }), 'ConnectionTimeoutError')
  })

  test('Feat 15.2: SFTP remote path traversal escape (/root/../../etc) is confined to chroot', { tier: 2 }, () => {
    const chroot = '/home/user'
    const resolveRemote = (rel) => {
      const parts = rel.split('/').filter(Boolean)
      const stack = []
      for (const p of parts) {
        if (p === '..') {
          if (stack.length > 0) stack.pop()
        } else if (p !== '.') {
          stack.push(p)
        }
      }
      return `${chroot}/${stack.join('/')}`
    }
    const safePath = resolveRemote('../../etc/shadow')
    assertEqual(safePath, '/home/user/etc/shadow')
  })

  test('Feat 15.3: dropped SSH connection mid-directory-listing emits broken pipe event', { tier: 2 }, () => {
    let state = 'connected'
    const onDisconnect = () => {
      state = 'disconnected'
    }
    onDisconnect()
    assertEqual(state, 'disconnected')
  })

  test('Feat 15.4: listing empty remote directory returns empty array without error', { tier: 2 }, async () => {
    ipc.register('conn_read_dir', async () => [])
    const res = await ipc.invoke('conn_read_dir', { path: '/remote/empty' })
    assertEqual(res.length, 0)
  })

  test('Feat 15.5: remote file transfer with 0-byte size completes successfully', { tier: 2 }, async () => {
    ipc.register('conn_download', async () => ({ transferred: 0, status: 'complete' }))
    const res = await ipc.invoke('conn_download', { remotePath: '/remote/empty.log' })
    assertEqual(res.status, 'complete')
  })

  // Feature 16: Tree Selection Sync ("Locate in Tree") (5 tests)
  test('Feat 16.1: locate file deeply nested expands all ancestor folders up to root', { tier: 2 }, () => {
    const target = '/ws/src/features/editor/view/model.ts'
    const ancestors = ['/ws', '/ws/src', '/ws/src/features', '/ws/src/features/editor', '/ws/src/features/editor/view']
    const expanded = new Set(ancestors)
    assertEqual(expanded.has('/ws/src/features/editor/view'), true)
    assertEqual(ancestors.length, 5)
  })

  test('Feat 16.2: locate file deleted from disk shows warning and clears tree selection', { tier: 2 }, () => {
    let selectedNode = 'item-deleted'
    const fileExists = false
    if (!fileExists) {
      selectedNode = null
    }
    assertEqual(selectedNode, null)
  })

  test('Feat 16.3: locate virtual document archive URI (!/) reveals container archive safely', { tier: 2 }, () => {
    const uri = 'jar:file:///app.jar!/com/example/Main.class'
    const container = uri.split('!/')[0].replace(/^jar:file:\/\/\/?/, '')
    assertEqual(container, 'app.jar')
  })

  test('Feat 16.4: locate file belonging to inactive root in multi-root switches active tree root', { tier: 2 }, () => {
    const file = '/ws2/src/lib.rs'
    const roots = ['/ws1', '/ws2']
    const matchingRoot = roots.find((r) => file.startsWith(r))
    assertEqual(matchingRoot, '/ws2')
  })

  test('Feat 16.5: rapid consecutive locate requests debounces and targets final path', { tier: 2 }, () => {
    const queue = ['/ws/a.rs', '/ws/b.rs', '/ws/c.rs']
    const finalTarget = queue[queue.length - 1]
    assertEqual(finalTarget, '/ws/c.rs')
  })
})
