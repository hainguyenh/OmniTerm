import type { Connection, Folder, WorkspaceEntry } from '@omniterm/contract'
import { buildWorkspaceTree, filterTreeByQuery, type WorkspaceTreeNode } from '../utils/scriptTree'
import { applyFilter, dirsHoldingConnections, type TreeFilter } from '../utils/workspaceFilter'

export interface WorkspacePanelView {
  tree: WorkspaceTreeNode[]
  folders: Folder[]
  files: WorkspaceEntry[]
}

interface BuildWorkspacePanelViewInput {
  workspaceId: string
  entries: WorkspaceEntry[]
  connections: Connection[]
  filesByFolder: Record<string, WorkspaceEntry[]>
  filter: TreeFilter
  query: string
  expandedDirs: Set<string>
}

export function collectDirKeys(workspaceId: string, nodes: WorkspaceTreeNode[]): string[] {
  const keys: string[] = []
  const walk = (node: WorkspaceTreeNode) => {
    if (!node.isDir) return
    keys.push(`${workspaceId}:${node.path}`)
    node.children.forEach(walk)
  }
  nodes.forEach(walk)
  return keys
}

export function buildWorkspacePanelView({
  workspaceId,
  entries,
  connections,
  filesByFolder,
  filter,
  query,
  expandedDirs,
}: BuildWorkspacePanelViewInput): WorkspacePanelView {
  const loaded = new Set(Object.keys(filesByFolder))
  const keep = dirsHoldingConnections(connections.map((connection) => connection.parentId))
  if (filter.mode === 'all' || filter.mode === 'types') {
    for (const entry of entries) {
      if (entry.isDir && !loaded.has(entry.id)) keep.add(entry.id)
    }
  }
  for (const key of expandedDirs) {
    if (key.startsWith(`${workspaceId}:`)) keep.add(key.slice(workspaceId.length + 1))
  }

  const filtered = applyFilter(entries, filter, keep)
  return {
    tree: filterTreeByQuery(buildWorkspaceTree(filtered, connections), query),
    folders: entries.filter((entry) => entry.isDir).map((entry) => ({
      id: entry.id,
      name: entry.name,
      parentId: entry.id.includes('/') ? entry.id.slice(0, entry.id.lastIndexOf('/')) : undefined,
    })),
    files: filtered.filter((entry) => !entry.isDir),
  }
}
