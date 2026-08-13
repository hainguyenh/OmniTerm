import { describe, expect, it } from 'vitest'
import type { Workspace } from '@omniterm/contract'
import { buildWorkspaceForest, orderedWorkspaceRows, siblingPosition, terminalWorkspaceSelection, workspaceDropIndex, workspacePinTarget } from '../workspaceHierarchy'

const ws = (id: string, parentId: string | undefined, order: number): Workspace => ({
  id,
  name: id,
  folders: [],
  parentId,
  order,
  pins: [],
})

describe('workspaceHierarchy', () => {
  it('builds roots and children in persisted sibling order', () => {
    const forest = buildWorkspaceForest([
      ws('child-b', 'root', 1),
      ws('root-b', undefined, 1),
      ws('root', undefined, 0),
      ws('child-a', 'root', 0),
    ])
    expect(forest.map(node => node.workspace.id)).toEqual(['root', 'root-b'])
    expect(forest[0].children.map(node => node.workspace.id)).toEqual(['child-a', 'child-b'])
  })

  it('returns a workspace position among only its siblings', () => {
    const items = [ws('root', undefined, 0), ws('child-a', 'root', 0), ws('child-b', 'root', 1)]
    expect(siblingPosition(items, 'child-b')).toEqual({ parentId: 'root', index: 1, count: 2 })
  })

  it('splits logical entry paths into the persisted pin identity', () => {
    expect(workspacePinTarget('folder#1/src/lib.ts')).toEqual({ folderId: 'folder#1', path: 'src/lib.ts' })
    expect(workspacePinTarget('folder#1')).toEqual({ folderId: 'folder#1', path: '' })
  })
})

describe('workspaceDropIndex', () => {
  it('keeps after-target drops adjacent when the source originally precedes the target', () => {
    const items = [ws('a', undefined, 0), ws('b', undefined, 1), ws('c', undefined, 2)]
    expect(workspaceDropIndex(items, 'a', 'b', 'after')).toEqual({ parentId: null, index: 1 })
  })

  it('keeps before-target drops adjacent when the source originally follows the target', () => {
    const items = [ws('a', undefined, 0), ws('b', undefined, 1), ws('c', undefined, 2)]
    expect(workspaceDropIndex(items, 'c', 'b', 'before')).toEqual({ parentId: null, index: 1 })
  })
  it('flattens hierarchy in visible order and picks only one-folder terminal workspaces', () => {
    const list = [
      ws('b', undefined, 1),
      ws('parent', undefined, 0),
      ws('child', 'parent', 0),
    ]
    list[0].folders.push({ id: 'b-root', name: 'B', path: '/b' })
    list[1].folders.push(
      { id: 'parent-a', name: 'Parent A', path: '/parent-a' },
      { id: 'parent-b', name: 'Parent B', path: '/parent-b' },
    )
    list[2].folders.push({ id: 'child-root', name: 'Child', path: '/child' })
    expect(orderedWorkspaceRows(list).map(row => [row.workspace.id, row.depth])).toEqual([
      ['parent', 0], ['child', 1], ['b', 0],
    ])
    expect(terminalWorkspaceSelection(list, 'parent')).toBe('child')
    expect(terminalWorkspaceSelection(list, 'b')).toBe('b')
  })

})
