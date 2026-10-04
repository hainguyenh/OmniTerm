import { describe, expect, it } from 'vitest'

import { layoutGraph } from '../gitGraphLayout'
import {
  buildGitTree,
  collectFolderPaths,
  getFileExtension,
  getFolderCheckState,
  type GitTreeFolderNode,
} from '../gitTreeUtils'
import type { GitCommitSummary, GitFileChange } from '../gitTypes'

const commit = (id: string, parents: string[]): GitCommitSummary => ({
  id,
  short_id: id,
  summary: `commit ${id}`,
  author_name: 'Dev',
  author_email: 'dev@example.com',
  timestamp: 0,
  parents,
})

const change = (path: string): GitFileChange => ({
  path,
  staged: 'modified',
  unstaged: 'unmodified',
  is_conflicted: false,
})

describe('layoutGraph', () => {
  it('returns the minimum width for an empty history', () => {
    expect(layoutGraph([])).toEqual({ rows: [], width: 32 })
  })

  it('keeps a linear history in a single lane', () => {
    const { rows, width } = layoutGraph([commit('c', ['b']), commit('b', ['a']), commit('a', [])])
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0])
    expect(rows.map((row) => row.color)).toEqual([0, 0, 0])
    expect(width).toBe(32)
    // The tip has no incoming edge; later commits are reached from above.
    expect(rows[0].edges).toEqual([{ path: 'M 16 26 C 16 42 16 38 16 52', color: 0 }])
    expect(rows[1].edges[0]).toEqual({ path: 'M 16 0 V 26', color: 0 })
    expect(rows[2].edges).toEqual([{ path: 'M 16 0 V 26', color: 0 }])
  })

  it('routes a merge into a second lane that rejoins at the shared parent', () => {
    const { rows, width } = layoutGraph([
      commit('m', ['a', 'b']),
      commit('b', ['base']),
      commit('a', ['base']),
      commit('base', []),
    ])
    expect(rows.map((row) => row.lane)).toEqual([0, 1, 0, 0])
    // The second parent gets a fresh color.
    expect(rows[0].color).toBe(0)
    expect(rows[1].color).toBe(1)
    expect(rows[0].edges).toEqual([
      { path: 'M 16 26 C 16 42 16 38 16 52', color: 0 },
      { path: 'M 16 26 C 16 42 38 38 38 52', color: 1 },
    ])
    // While `b` is drawn, lane 0 passes straight through to the commit below.
    expect(rows[1].edges).toContainEqual({ path: 'M 16 0 C 16 26 16 26 16 52', color: 0 })
    // When `a` lands, the `base` lane opened by `b` shifts back towards lane 0.
    expect(rows[2].edges).toContainEqual({ path: 'M 38 0 C 38 26 16 26 16 52', color: 1 })
    expect(width).toBe(2 * 22 + 10)
  })

  it('cycles colors for unrelated branch tips and recycles after five lanes', () => {
    const tips = ['t0', 't1', 't2', 't3', 't4', 't5'].map((id) => commit(id, []))
    const { rows, width } = layoutGraph(tips)
    expect(rows.map((row) => row.color)).toEqual([0, 1, 2, 3, 4, 0])
    expect(rows.every((row) => row.lane === 0)).toBe(true)
    expect(rows.every((row) => row.edges.length === 0)).toBe(true)
    expect(width).toBe(32)
  })
})

describe('gitTreeUtils coverage', () => {
  it('derives extensions for dotfiles, dotted dotfiles, and extensionless names', () => {
    expect(getFileExtension('config/.env')).toBe('env')
    expect(getFileExtension('.eslintrc.JSON')).toBe('json')
    expect(getFileExtension('bin/Makefile')).toBe('makefile')
    expect(getFileExtension('docs/Guide.MD')).toBe('md')
  })

  it('stops compacting a folder chain where a folder holds files', () => {
    const tree = buildGitTree([
      change('a/b/c/deep.ts'),
      change('a/top.ts'),
      change('a/b/zeta.ts'),
      change('a/b/alpha.ts'),
    ])
    expect(tree).toHaveLength(1)
    const a = tree[0] as GitTreeFolderNode
    expect(a.name).toBe('a')
    expect(a.children.map((node) => node.name)).toEqual(['b', 'top.ts'])
    const b = a.children[0] as GitTreeFolderNode
    expect(b.path).toBe('a/b')
    expect(b.children.map((node) => node.name)).toEqual(['c', 'alpha.ts', 'zeta.ts'])
    expect(b.allFiles.map((file) => file.path)).toEqual(['a/b/c/deep.ts', 'a/b/alpha.ts', 'a/b/zeta.ts'])
    expect(a.allFiles).toHaveLength(4)
  })

  it('reports an empty folder as neither checked nor indeterminate', () => {
    const empty: GitTreeFolderNode = { type: 'folder', name: 'x', path: 'x', children: [], allFiles: [] }
    expect(getFolderCheckState(empty, new Set(['x/file.ts']))).toEqual({ checked: false, indeterminate: false })
  })

  it('reports none, some, and all selected files of a folder', () => {
    const folder = buildGitTree([change('src/a.ts'), change('src/b.ts')])[0] as GitTreeFolderNode
    expect(getFolderCheckState(folder, new Set())).toEqual({ checked: false, indeterminate: false })
    expect(getFolderCheckState(folder, new Set(['src/a.ts']))).toEqual({ checked: false, indeterminate: true })
    expect(getFolderCheckState(folder, new Set(['src/a.ts', 'src/b.ts']))).toEqual({ checked: true, indeterminate: false })
  })

  it('collects every nested folder path depth first and skips files', () => {
    const tree = buildGitTree([
      change('root.ts'),
      change('ui/app.ts'),
      change('ui/parts/view.ts'),
      change('crates/core/src/lib.rs'),
      change('crates/protocol/lib.rs'),
    ])
    expect(collectFolderPaths(tree)).toEqual(['crates', 'crates/core/src', 'crates/protocol', 'ui', 'ui/parts'])
    expect(collectFolderPaths([])).toEqual([])
  })
})
