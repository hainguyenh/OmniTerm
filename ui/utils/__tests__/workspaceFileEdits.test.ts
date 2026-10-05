import { describe, expect, it } from 'vitest'
import type { WorkspaceEntry } from '@omniterm/contract'

import { childPath, moveDestinations, parentPath } from '../workspaceFileEdits'

const dir = (id: string): WorkspaceEntry => ({
  id, name: id.split('/').pop() ?? id, path: id, isDir: true, kind: 'dir',
})

describe('workspaceFileEdits', () => {
  it('splits and joins folder-namespaced logical paths', () => {
    expect(parentPath('folder#1/src/app.ts')).toBe('folder#1/src')
    expect(parentPath('folder#1/app.ts')).toBe('folder#1')
    expect(parentPath('folder#1')).toBe('')
    expect(childPath('folder#1/src', 'lib.ts')).toBe('folder#1/src/lib.ts')
    expect(childPath('', 'folder#1')).toBe('folder#1')
  })

  it('labels every scanned folder with its workspace folder name, sorted', () => {
    const roots = [
      { id: 'folder#1', name: 'api', path: 'C:/api' },
      { id: 'folder#2', name: 'web', path: 'C:/web' },
    ]
    const entries: WorkspaceEntry[] = [
      dir('folder#2'),
      dir('folder#1/src'),
      dir('folder#1'),
      { id: 'folder#1/readme.md', name: 'readme.md', path: 'folder#1/readme.md', isDir: false, kind: 'md' },
      dir('folder#9/orphan'),
    ]
    expect(moveDestinations(roots, entries)).toEqual([
      { id: 'folder#1', label: 'api' },
      { id: 'folder#1/src', label: 'api/src' },
      { id: 'folder#9/orphan', label: 'folder#9/orphan' },
      { id: 'folder#2', label: 'web' },
    ])
  })
})
