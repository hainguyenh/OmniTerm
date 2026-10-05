import { describe, expect, it } from 'vitest'
import {
  buildGitTree,
  getFileExtension,
  getFolderCheckState,
  type GitTreeFolderNode,
} from '../gitTreeUtils'
import type { GitFileChange } from '../gitTypes'

describe('gitTreeUtils', () => {
  const mockFiles: GitFileChange[] = [
    { path: 'crates/app-core/src/git.rs', staged: 'modified', unstaged: 'unmodified', is_conflicted: false },
    { path: 'crates/app-core/src/git_diff.rs', staged: 'unmodified', unstaged: 'modified', is_conflicted: false },
    { path: 'ui/gitAPI.ts', staged: 'unmodified', unstaged: 'untracked', is_conflicted: false },
    { path: 'README.md', staged: 'added', unstaged: 'unmodified', is_conflicted: false },
  ]

  it('extracts file extension or lowercase name accurately', () => {
    expect(getFileExtension('src/main.rs')).toBe('rs')
    expect(getFileExtension('ui/components/GitPanel.tsx')).toBe('tsx')
    expect(getFileExtension('Dockerfile')).toBe('dockerfile')
    expect(getFileExtension('.gitignore')).toBe('gitignore')
  })

  it('builds hierarchical tree with compacted single-child folder chains', () => {
    const tree = buildGitTree(mockFiles)
    expect(tree.length).toBe(3) // crates, ui, README.md

    const cratesFolder = tree.find((n) => n.name === 'crates/app-core/src') as GitTreeFolderNode
    expect(cratesFolder).toBeDefined()
    expect(cratesFolder.type).toBe('folder')
    expect(cratesFolder.children.length).toBe(2)
    const childNames = cratesFolder.children.map((c) => c.name)
    expect(childNames).toContain('git.rs')
    expect(childNames).toContain('git_diff.rs')

    const uiFolder = tree.find((n) => n.name === 'ui') as GitTreeFolderNode
    expect(uiFolder).toBeDefined()
    expect(uiFolder.children.length).toBe(1)
    expect(uiFolder.children[0].name).toBe('gitAPI.ts')

    const rootFile = tree.find((n) => n.name === 'README.md')
    expect(rootFile).toBeDefined()
    expect(rootFile?.type).toBe('file')
  })

  it('keeps a wholly untracked directory as one named entry instead of a nameless file', () => {
    const tree = buildGitTree([
      { path: 'ui/__scratch__/', staged: 'unmodified', unstaged: 'untracked', is_conflicted: false },
      { path: 'ui/a.ts', staged: 'unmodified', unstaged: 'modified', is_conflicted: false },
    ])
    const uiFolder = tree[0] as GitTreeFolderNode
    expect(uiFolder.name).toBe('ui')
    expect(uiFolder.children.map((child) => [child.type, child.name])).toEqual([
      ['file', '__scratch__/'],
      ['file', 'a.ts'],
    ])
    expect(uiFolder.children[0].path).toBe('ui/__scratch__/')
  })

  it('calculates folder check state correctly (checked, unchecked, indeterminate)', () => {
    const tree = buildGitTree(mockFiles)
    const cratesFolder = tree.find((n) => n.name === 'crates/app-core/src') as GitTreeFolderNode

    // None checked
    expect(getFolderCheckState(cratesFolder, new Set())).toEqual({ checked: false, indeterminate: false })

    // One checked (indeterminate)
    const oneChecked = new Set(['crates/app-core/src/git.rs'])
    expect(getFolderCheckState(cratesFolder, oneChecked)).toEqual({ checked: false, indeterminate: true })

    // All checked
    const allChecked = new Set([
      'crates/app-core/src/git.rs',
      'crates/app-core/src/git_diff.rs',
    ])
    expect(getFolderCheckState(cratesFolder, allChecked)).toEqual({ checked: true, indeterminate: false })
  })
})
