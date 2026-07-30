import { describe, it, expect } from 'vitest'
import { buildScriptTree, buildWorkspaceTree, filterTreeByQuery } from '../scriptTree'
import type { Connection, WorkspaceEntry, WorkspaceScript } from '@omniterm/contract'

const s = (id: string, kind = 'sh'): WorkspaceScript => ({
  id, name: id.split('/').pop()!, path: `/root/${id}`, kind, editable: kind !== 'rdp',
})

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

describe('buildScriptTree', () => {
  it('nests scripts under their directories and keeps root leaves at top level', () => {
    const tree = buildScriptTree([s('deploy.bat'), s('scripts/ci/test.sh'), s('scripts/build.ps1')])

    // Root: folder "scripts" (dirs first), then file "deploy.bat".
    expect(tree.map((n) => [n.name, n.isDir])).toEqual([
      ['scripts', true],
      ['deploy.bat', false],
    ])

    const scriptsDir = tree[0]
    // Inside "scripts": folder "ci" first, then file "build.ps1".
    expect(scriptsDir.children.map((n) => [n.name, n.isDir])).toEqual([
      ['ci', true],
      ['build.ps1', false],
    ])
    expect(scriptsDir.children[0].children.map((n) => n.name)).toEqual(['test.sh'])
    expect(scriptsDir.children[0].children[0].script?.id).toBe('scripts/ci/test.sh')
  })

  it('sorts folders before files, case-insensitively', () => {
    const tree = buildScriptTree([s('Zebra.bat'), s('alpha.ps1'), s('lib/x.sh')])
    expect(tree.map((n) => n.name)).toEqual(['lib', 'alpha.ps1', 'Zebra.bat'])
  })
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
