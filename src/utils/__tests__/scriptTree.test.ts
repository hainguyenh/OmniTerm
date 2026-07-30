import { describe, it, expect } from 'vitest'
import { buildWorkspaceTree, entryNode, filterTreeByQuery } from '../scriptTree'
import type { Connection, WorkspaceEntry } from '@omniterm/contract'

const dir = (id: string): WorkspaceEntry => ({
  id, name: id.split('/').pop()!, path: `/root/${id}`, isDir: true, kind: 'dir',
})

const file = (id: string, kind: string): WorkspaceEntry => ({
  id, name: id.split('/').pop()!, path: `/root/${id}`, isDir: false, kind,
  ...(['bat', 'ps1', 'sh', 'rdp'].includes(kind) ? { editable: kind !== 'rdp' } : {}),
})

const conn = (id: string, name: string, parentId?: string): Connection => ({
  id, name, type: 'SSH', host: 'box.internal', port: '22', user: 'ops', parentId,
})

describe('buildWorkspaceTree', () => {
  // The whole point of scanning directories explicitly: a folder with nothing in it is real, and
  // building the tree from file paths alone could never show it.
  it('keeps a directory that holds no files', () => {
    const tree = buildWorkspaceTree([dir('empty'), dir('tools'), file('tools/go.sh', 'sh')])
    expect(tree.map((n) => n.name)).toEqual(['empty', 'tools'])
    expect(tree[0].children).toEqual([])
    expect(tree[0].entry?.isDir).toBe(true)
  })

  it('marks only runnable files with a script record', () => {
    const tree = buildWorkspaceTree([file('go.sh', 'sh'), file('notes.txt', 'txt')])
    const byName = Object.fromEntries(tree.map((n) => [n.name, n]))
    expect(byName['go.sh'].script?.kind).toBe('sh')
    expect(byName['notes.txt'].script).toBeUndefined()
    expect(byName['notes.txt'].entry?.kind).toBe('txt')
  })

  it('nests a connection under the folder named by its parentId', () => {
    const tree = buildWorkspaceTree(
      [dir('infra'), dir('infra/prod')],
      [conn('c1', 'prod-web', 'infra/prod'), conn('c2', 'root-box')],
    )
    expect(tree.map((n) => n.name)).toEqual(['infra', 'root-box'])
    const prod = tree[0].children[0]
    expect(prod.name).toBe('prod')
    expect(prod.children.map((n) => n.connection?.name)).toEqual(['prod-web'])
  })

  // A folder can be renamed or deleted long after a connection was saved against it. Dropping the
  // connection (or hanging it off a synthesized ghost folder) would make it unreachable.
  it('falls back to the root when a connection points at a folder that is gone', () => {
    const tree = buildWorkspaceTree([dir('infra')], [conn('c1', 'orphan', 'was/here')])
    expect(tree.map((n) => n.name)).toEqual(['infra', 'orphan'])
  })

  it('orders folders, then connections, then files', () => {
    const tree = buildWorkspaceTree(
      [dir('lib'), file('a.txt', 'txt'), file('z.sh', 'sh')],
      [conn('c1', 'mbox')],
    )
    expect(tree.map((n) => n.name)).toEqual(['lib', 'mbox', 'a.txt', 'z.sh'])
  })
})

describe('filterTreeByQuery', () => {
  const tree = () =>
    buildWorkspaceTree(
      [dir('infra'), dir('infra/prod'), file('infra/prod/deploy.sh', 'sh'), file('readme.txt', 'txt')],
      [conn('c1', 'web-1', 'infra')],
    )

  it('returns the tree untouched for an empty query', () => {
    expect(filterTreeByQuery(tree(), '   ')).toEqual(tree())
  })

  it('keeps the ancestors of a matching file', () => {
    const found = filterTreeByQuery(tree(), 'deploy')
    expect(found.map((n) => n.name)).toEqual(['infra'])
    expect(found[0].children[0].children.map((n) => n.name)).toEqual(['deploy.sh'])
  })

  it('matches a connection on its user@host:port as well as its name', () => {
    expect(filterTreeByQuery(tree(), 'ops@box')[0].children.map((n) => n.name)).toEqual(['web-1'])
    expect(filterTreeByQuery(tree(), 'web-1')[0].children.map((n) => n.name)).toEqual(['web-1'])
  })

  it('keeps everything under a folder whose own name matches', () => {
    const found = filterTreeByQuery(tree(), 'prod')
    expect(found[0].children[0].children.map((n) => n.name)).toEqual(['deploy.sh'])
  })

  it('drops branches with no match at all', () => {
    expect(filterTreeByQuery(tree(), 'nothing-here')).toEqual([])
  })
})

describe('entryNode / openable', () => {
  /** A file the scan marked viewable gets an `openable` record even though it is not runnable. */
  it('marks a viewable non-script file openable but not runnable', () => {
    const node = entryNode({ ...file('notes.txt', 'txt'), viewable: true })
    expect(node.script).toBeUndefined()
    expect(node.openable?.path).toBe('/root/notes.txt')
    // The flag travels on the record the viewer receives, so ScriptViewer can key its body off it.
    expect(node.openable?.viewable).toBe(true)
    expect(node.openable?.editable).toBe(false)
  })

  it('leaves a denied kind neither openable nor runnable', () => {
    const node = entryNode({ ...file('payload.exe', 'exe'), viewable: false })
    expect(node.script).toBeUndefined()
    expect(node.openable).toBeUndefined()
  })

  it('keeps a script both openable and runnable', () => {
    const node = entryNode({ ...file('deploy.bat', 'bat'), viewable: true })
    expect(node.script?.id).toBe('deploy.bat')
    expect(node.openable?.editable).toBe(true)
  })

  /**
   * A provider predating `viewable` reports nothing at all. Its scripts must stay openable, and its
   * plain files must stay closed — i.e. exactly the previous behaviour.
   */
  it('falls back to "runnable means viewable" when the flag is absent', () => {
    expect(entryNode(file('deploy.bat', 'bat')).openable).toBeDefined()
    expect(entryNode(file('notes.txt', 'txt')).openable).toBeUndefined()
  })

  /** The regression this constructor exists to prevent — both views must agree. */
  it('gives the tree view the same openable records the flat view builds', () => {
    const entries = [dir('sub'), { ...file('sub/notes.txt', 'txt'), viewable: true }]
    const fromTree = buildWorkspaceTree(entries)[0].children[0]
    const fromFlat = entryNode(entries[1])
    expect(fromTree.openable).toEqual(fromFlat.openable)
  })
})
