import type { GitFileChange } from './gitTypes'

export interface GitTreeFileNode {
  type: 'file'
  name: string
  path: string
  file: GitFileChange
}

export interface GitTreeFolderNode {
  type: 'folder'
  name: string
  path: string
  children: GitTreeNode[]
  allFiles: GitFileChange[]
}

export type GitTreeNode = GitTreeFileNode | GitTreeFolderNode

/**
 * Extracts the file extension or basename lowercase for fileKindMeta.
 */
export function getFileExtension(path: string): string {
  const base = path.split('/').pop() ?? path
  if (base.startsWith('.') && base.indexOf('.', 1) === -1) {
    return base.slice(1).toLowerCase()
  }
  const dotIdx = base.lastIndexOf('.')
  return dotIdx > 0 ? base.slice(dotIdx + 1).toLowerCase() : base.toLowerCase()
}

/**
 * Recursively builds a directory tree structure from a flat list of GitFileChanges.
 * Automatically compacts single-child folder chains (e.g. `crates/app-core/src`).
 */
export function buildGitTree(files: GitFileChange[]): GitTreeNode[] {
  interface IntermediateFolder {
    name: string
    subfolders: Map<string, IntermediateFolder>
    files: GitFileChange[]
  }

  const root: IntermediateFolder = {
    name: '',
    subfolders: new Map(),
    files: [],
  }

  for (const file of files) {
    const parts = file.path.split('/')
    let current = root

    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]
      let next = current.subfolders.get(seg)
      if (!next) {
        next = { name: seg, subfolders: new Map(), files: [] }
        current.subfolders.set(seg, next)
      }
      current = next
    }

    current.files.push(file)
  }

  function convertFolder(folder: IntermediateFolder, parentPath: string): GitTreeNode[] {
    const nodes: GitTreeNode[] = []

    // Sort folder entries alphabetically
    const sortedSubfolderKeys = Array.from(folder.subfolders.keys()).sort((a, b) =>
      a.localeCompare(b),
    )

    for (const key of sortedSubfolderKeys) {
      let sub = folder.subfolders.get(key)!
      let folderName = sub.name
      let currentPath = parentPath ? `${parentPath}/${folderName}` : folderName

      // Compact single-child folder chains (e.g. crates/app-core/src)
      while (sub.files.length === 0 && sub.subfolders.size === 1) {
        const onlyChildKey = sub.subfolders.keys().next().value!
        const nextSub = sub.subfolders.get(onlyChildKey)!
        folderName = `${folderName}/${nextSub.name}`
        currentPath = `${currentPath}/${nextSub.name}`
        sub = nextSub
      }

      const children = convertFolder(sub, currentPath)
      const allFiles = collectAllFiles(children)

      nodes.push({
        type: 'folder',
        name: folderName,
        path: currentPath,
        children,
        allFiles,
      })
    }

    // Sort files alphabetically
    const sortedFiles = [...folder.files].sort((a, b) => {
      const aName = a.path.split('/').pop() ?? a.path
      const bName = b.path.split('/').pop() ?? b.path
      return aName.localeCompare(bName)
    })

    for (const file of sortedFiles) {
      const name = file.path.split('/').pop() ?? file.path
      nodes.push({
        type: 'file',
        name,
        path: file.path,
        file,
      })
    }

    return nodes
  }

  function collectAllFiles(nodes: GitTreeNode[]): GitFileChange[] {
    const result: GitFileChange[] = []
    for (const node of nodes) {
      if (node.type === 'file') {
        result.push(node.file)
      } else {
        result.push(...node.allFiles)
      }
    }
    return result
  }

  return convertFolder(root, '')
}

/**
 * Checks if a folder node has all, some, or none of its files selected.
 */
export function getFolderCheckState(
  folder: GitTreeFolderNode,
  checkedPaths: Set<string>,
): { checked: boolean; indeterminate: boolean } {
  if (folder.allFiles.length === 0) {
    return { checked: false, indeterminate: false }
  }

  let checkedCount = 0
  for (const f of folder.allFiles) {
    if (checkedPaths.has(f.path)) {
      checkedCount++
    }
  }

  return {
    checked: checkedCount === folder.allFiles.length,
    indeterminate: checkedCount > 0 && checkedCount < folder.allFiles.length,
  }
}

/**
 * Collects all folder paths recursively from a list of tree nodes.
 */
export function collectFolderPaths(nodes: GitTreeNode[]): string[] {
  const paths: string[] = []
  for (const n of nodes) {
    if (n.type === 'folder') {
      paths.push(n.path)
      paths.push(...collectFolderPaths(n.children))
    }
  }
  return paths
}
