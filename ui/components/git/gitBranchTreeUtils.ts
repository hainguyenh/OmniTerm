import type { GitBranchInfo } from './gitTypes'

export interface GitBranchLeafNode {
  type: 'branch'
  name: string
  displayName: string
  branch: GitBranchInfo
}

export interface GitBranchFolderNode {
  type: 'folder'
  name: string
  path: string
  children: GitBranchTreeNode[]
  allBranches: GitBranchInfo[]
}

export type GitBranchTreeNode = GitBranchLeafNode | GitBranchFolderNode

/**
 * Builds a hierarchical tree structure of branches grouped by path segments (e.g. feature/a, feature/b).
 */
export function buildBranchTree(branches: GitBranchInfo[]): GitBranchTreeNode[] {
  interface IntermediateFolder {
    name: string
    subfolders: Map<string, IntermediateFolder>
    branches: GitBranchInfo[]
  }

  const root: IntermediateFolder = {
    name: '',
    subfolders: new Map(),
    branches: [],
  }

  for (const branch of branches) {
    const parts = branch.name.split('/')
    if (parts.length === 1) {
      root.branches.push(branch)
      continue
    }

    let current = root
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]
      let next = current.subfolders.get(seg)
      if (!next) {
        next = { name: seg, subfolders: new Map(), branches: [] }
        current.subfolders.set(seg, next)
      }
      current = next
    }
    current.branches.push(branch)
  }

  function convertFolder(folder: IntermediateFolder, parentPath: string): GitBranchTreeNode[] {
    const nodes: GitBranchTreeNode[] = []

    const sortedSubfolderKeys = Array.from(folder.subfolders.keys()).sort((a, b) =>
      a.localeCompare(b),
    )

    for (const key of sortedSubfolderKeys) {
      let sub = folder.subfolders.get(key)!
      let folderName = sub.name
      let currentPath = parentPath ? `${parentPath}/${folderName}` : folderName

      // Compact single-child folder chains (e.g. release/v1)
      while (sub.branches.length === 0 && sub.subfolders.size === 1) {
        const onlyChildKey = sub.subfolders.keys().next().value!
        const nextSub = sub.subfolders.get(onlyChildKey)!
        folderName = `${folderName}/${nextSub.name}`
        currentPath = `${currentPath}/${nextSub.name}`
        sub = nextSub
      }

      const children = convertFolder(sub, currentPath)
      const allBranches = collectAllBranches(children)

      nodes.push({
        type: 'folder',
        name: folderName,
        path: currentPath,
        children,
        allBranches,
      })
    }

    // Sort leaf branches alphabetically, with active/current branch first
    const sortedBranches = [...folder.branches].sort((a, b) => {
      if (a.is_current && !b.is_current) return -1
      if (!a.is_current && b.is_current) return 1
      const aName = a.name.split('/').pop() ?? a.name
      const bName = b.name.split('/').pop() ?? b.name
      return aName.localeCompare(bName)
    })

    for (const b of sortedBranches) {
      const displayName = b.name.split('/').pop() ?? b.name
      nodes.push({
        type: 'branch',
        name: b.name,
        displayName,
        branch: b,
      })
    }

    return nodes
  }

  function collectAllBranches(nodes: GitBranchTreeNode[]): GitBranchInfo[] {
    const result: GitBranchInfo[] = []
    for (const node of nodes) {
      if (node.type === 'branch') {
        result.push(node.branch)
      } else {
        result.push(...node.allBranches)
      }
    }
    return result
  }

  return convertFolder(root, '')
}

/**
 * Recursively filters branch tree nodes matching the search query.
 */
export function filterBranchTree(nodes: GitBranchTreeNode[], query: string): GitBranchTreeNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes

  const filtered: GitBranchTreeNode[] = []

  for (const node of nodes) {
    if (node.type === 'branch') {
      if (node.name.toLowerCase().includes(q)) {
        filtered.push(node)
      }
    } else {
      const matchingChildren = filterBranchTree(node.children, q)
      if (matchingChildren.length > 0) {
        filtered.push({
          ...node,
          children: matchingChildren,
          allBranches: matchingChildren.flatMap((c) =>
            c.type === 'branch' ? [c.branch] : c.allBranches,
          ),
        })
      }
    }
  }

  return filtered
}
