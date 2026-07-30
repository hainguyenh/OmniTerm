import { describe, it, expect } from 'vitest'
import type { WorkspaceEntry } from '@omniterm/contract'
import {
  DEFAULT_TREE_FILTER,
  applyFilter,
  dirsHoldingConnections,
  discoverKinds,
  filterSummary,
  isDefaultFilter,
  isScriptEntry,
} from '../workspaceFilter'

const dir = (id: string): WorkspaceEntry => ({
  id, name: id.split('/').pop()!, path: `/root/${id}`, isDir: true, kind: 'dir',
})

const file = (id: string, kind: string): WorkspaceEntry => ({
  id, name: id.split('/').pop()!, path: `/root/${id}`, isDir: false, kind,
  ...(['bat', 'ps1', 'sh', 'rdp'].includes(kind) ? { editable: kind !== 'rdp' } : {}),
})

const ids = (entries: WorkspaceEntry[]) => entries.map((e) => e.id).sort()

const scan = [
  dir('docs'),
  dir('infra'),
  file('docs/notes.txt', 'txt'),
  file('infra/deploy.ps1', 'ps1'),
  file('infra/host.rdp', 'rdp'),
  file('README', 'file'),
]

describe('isScriptEntry', () => {
  it('accepts the runnable kinds and rejects folders and plain files', () => {
    expect(isScriptEntry(file('a.ps1', 'ps1'))).toBe(true)
    expect(isScriptEntry(file('a.rdp', 'rdp'))).toBe(true)
    expect(isScriptEntry(file('a.txt', 'txt'))).toBe(false)
    expect(isScriptEntry(dir('a'))).toBe(false)
  })
})

describe('isDefaultFilter', () => {
  it('ignores the path selection, which only exists once the mode has already changed', () => {
    expect(isDefaultFilter(DEFAULT_TREE_FILTER)).toBe(true)
    expect(isDefaultFilter({ ...DEFAULT_TREE_FILTER, paths: ['a.sh'] })).toBe(true)
    expect(isDefaultFilter({ ...DEFAULT_TREE_FILTER, mode: 'all' })).toBe(false)
    expect(isDefaultFilter({ ...DEFAULT_TREE_FILTER, showEmptyDirs: true })).toBe(false)
  })
})

describe('filterSummary', () => {
  it('names the mode, and counts only where the count is the whole story', () => {
    expect(filterSummary(DEFAULT_TREE_FILTER, 4)).toBe('Scripts')
    expect(filterSummary({ ...DEFAULT_TREE_FILTER, mode: 'all' }, 9)).toBe('All files')
    expect(filterSummary({ ...DEFAULT_TREE_FILTER, mode: 'selected' }, 3)).toBe('3 files')
    expect(filterSummary({ ...DEFAULT_TREE_FILTER, mode: 'selected' }, 1)).toBe('1 file')
  })

  // One type is the common case and is worth naming; past that only the count fits.
  it('names a single type but counts several', () => {
    expect(filterSummary({ ...DEFAULT_TREE_FILTER, mode: 'types', kinds: ['ps1'] }, 7)).toBe('.ps1')
    expect(filterSummary({ ...DEFAULT_TREE_FILTER, mode: 'types', kinds: ['ps1', 'sh'] }, 7)).toBe('2 types')
  })
})

describe('discoverKinds', () => {
  it('lists the kinds actually present, sorted, with folders left out', () => {
    expect(discoverKinds(scan)).toEqual(['file', 'ps1', 'rdp', 'txt'])
  })
})

describe('applyFilter', () => {
  // The default hides empty folders, so `docs` — which holds only a .txt — is not worth a row.
  it('shows scripts and the folders holding them by default', () => {
    expect(ids(applyFilter(scan, DEFAULT_TREE_FILTER))).toEqual([
      'infra', 'infra/deploy.ps1', 'infra/host.rdp',
    ])
  })

  it('shows every file in all mode', () => {
    expect(ids(applyFilter(scan, { ...DEFAULT_TREE_FILTER, mode: 'all' })).length).toBe(scan.length)
  })

  it('shows only the ticked files in selected mode', () => {
    const filtered = applyFilter(scan, {
      ...DEFAULT_TREE_FILTER, mode: 'selected', paths: ['docs/notes.txt'], showEmptyDirs: true,
    })
    expect(ids(filtered)).toEqual(['docs', 'docs/notes.txt', 'infra'])
  })

  // A type covers files that were not there when the filter was set, which is the point of having it.
  it('shows every file of a chosen kind in types mode', () => {
    const filtered = applyFilter(
      [...scan, file('infra/rollback.ps1', 'ps1')],
      { ...DEFAULT_TREE_FILTER, mode: 'types', kinds: ['ps1'] },
    )
    expect(ids(filtered)).toEqual(['infra', 'infra/deploy.ps1', 'infra/rollback.ps1'])
  })

  it('ignores a ticked path the scan no longer contains', () => {
    const filtered = applyFilter(scan, { ...DEFAULT_TREE_FILTER, mode: 'selected', paths: ['docs/gone.txt'], showEmptyDirs: false })
    expect(ids(filtered)).toEqual([])
  })

  it('prunes folders left with nothing when empty folders are hidden', () => {
    const filtered = applyFilter(scan, { ...DEFAULT_TREE_FILTER, mode: 'selected', paths: ['docs/notes.txt'], showEmptyDirs: false })
    expect(ids(filtered)).toEqual(['docs', 'docs/notes.txt'])
  })

  it('keeps ancestors of a kept file when empty folders are hidden', () => {
    const deep = [dir('a'), dir('a/b'), dir('a/b/c'), file('a/b/c/go.sh', 'sh')]
    const filtered = applyFilter(deep, DEFAULT_TREE_FILTER)
    expect(ids(filtered)).toEqual(['a', 'a/b', 'a/b/c', 'a/b/c/go.sh'])
  })

  // A display filter must not be able to re-parent a saved connection to the root.
  it('keeps a folder that holds a connection even with empty folders hidden', () => {
    const filtered = applyFilter(
      scan,
      { ...DEFAULT_TREE_FILTER, mode: 'selected', paths: ['docs/notes.txt'], showEmptyDirs: false },
      dirsHoldingConnections(['infra']),
    )
    expect(ids(filtered)).toEqual(['docs', 'docs/notes.txt', 'infra'])
  })
})

describe('dirsHoldingConnections', () => {
  it('includes every ancestor and ignores root-level connections', () => {
    expect([...dirsHoldingConnections(['a/b/c', undefined, ''])].sort()).toEqual(['a', 'a/b', 'a/b/c'])
  })
})
