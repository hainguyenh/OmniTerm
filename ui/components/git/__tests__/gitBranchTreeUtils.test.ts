import { describe, expect, it } from 'vitest'
import {
  buildBranchTree,
  filterBranchTree,
  type GitBranchFolderNode,
  type GitBranchLeafNode,
} from '../gitBranchTreeUtils'
import type { GitBranchInfo } from '../gitTypes'

describe('gitBranchTreeUtils', () => {
  const branches: GitBranchInfo[] = [
    {
      name: 'master',
      is_current: false,
      is_remote: false,
      ahead: 0,
      behind: 0,
      is_gone: false,
    },
    {
      name: 'feature/auth/login',
      is_current: false,
      is_remote: false,
      ahead: 1,
      behind: 0,
      is_gone: false,
    },
    {
      name: 'feature/auth/signup',
      is_current: true,
      is_remote: false,
      ahead: 0,
      behind: 0,
      is_gone: false,
    },
    {
      name: 'feature/dashboard',
      is_current: false,
      is_remote: false,
      ahead: 0,
      behind: 2,
      is_gone: false,
    },
    {
      name: 'bugfix/typo',
      is_current: false,
      is_remote: false,
      ahead: 0,
      behind: 0,
      is_gone: false,
    },
  ]

  it('builds a tree grouping branches by folder paths', () => {
    const tree = buildBranchTree(branches)

    // Should have top-level folders 'bugfix', 'feature' and root branch 'master'
    const folderNames = tree.filter((n) => n.type === 'folder').map((n) => n.name)
    expect(folderNames).toContain('bugfix')
    expect(folderNames).toContain('feature')

    const rootBranches = tree.filter((n) => n.type === 'branch') as GitBranchLeafNode[]
    expect(rootBranches.map((b) => b.name)).toContain('master')

    // Find feature folder
    const featureFolder = tree.find(
      (n) => n.type === 'folder' && n.name === 'feature',
    ) as GitBranchFolderNode
    expect(featureFolder).toBeDefined()
    expect(featureFolder.children.length).toBeGreaterThan(0)

    // In feature folder: should have 'dashboard' leaf and 'auth' folder
    const subFolder = featureFolder.children.find(
      (c) => c.type === 'folder' && c.name === 'auth',
    ) as GitBranchFolderNode
    expect(subFolder).toBeDefined()
    expect(subFolder.children.map((c) => c.name)).toContain('feature/auth/login')
    expect(subFolder.children.map((c) => c.name)).toContain('feature/auth/signup')
  })

  it('filters branch tree by query string while preserving folder hierarchy', () => {
    const tree = buildBranchTree(branches)
    const filtered = filterBranchTree(tree, 'login')

    expect(filtered.length).toBe(1)
    const feature = filtered[0] as GitBranchFolderNode
    expect(feature.name).toBe('feature')

    const auth = feature.children[0] as GitBranchFolderNode
    expect(auth.name).toBe('auth')
    expect(auth.children[0].name).toBe('feature/auth/login')
  })

  it('returns empty tree when query matches nothing', () => {
    const tree = buildBranchTree(branches)
    const filtered = filterBranchTree(tree, 'nonexistent-xyz')
    expect(filtered.length).toBe(0)
  })
})
