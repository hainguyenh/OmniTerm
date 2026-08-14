import type { Connection, Folder, WorkspaceEntry, WorkspacePin } from '@omniterm/contract'
import { buildWorkspaceTree, filterTreeByQuery, type WorkspaceTreeNode } from '../utils/scriptTree'
import { applyFilter, DEFAULT_FOLDER_FILTER, dirsHoldingConnections, type TreeFilter } from '../utils/workspaceFilter'

export interface WorkspacePanelView {
  tree: WorkspaceTreeNode[]
  folders: Folder[]
  files: WorkspaceEntry[]
}

interface BuildWorkspacePanelViewInput {
  workspaceId: string
  entries: WorkspaceEntry[]
  connections: Connection[]
  pins: WorkspacePin[]
  rootFolders?: Folder[]
  filesByFolder: Record<string, WorkspaceEntry[]>
  filter: TreeFilter
  folderFilters?: Record<string, TreeFilter>
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
  pins,
  rootFolders,
  filesByFolder,
  filter,
  folderFilters = {},
  query,
  expandedDirs,
}: BuildWorkspacePanelViewInput): WorkspacePanelView {
  const loaded = new Set(Object.keys(filesByFolder))
  const keep = dirsHoldingConnections(connections.map((connection) => connection.parentId))
  const rootFolderIds = new Set((rootFolders ?? []).map((f) => f.id))
  if (filter.mode === 'all' || filter.mode === 'types') {
    for (const entry of entries) {
      if (entry.isDir && !loaded.has(entry.id)) keep.add(entry.id)
    }
  }
  for (const entry of entries) {
    if (entry.isDir && rootFolderIds.has(entry.id)) keep.add(entry.id)
  }
  for (const key of expandedDirs) {
    if (key.startsWith(`${workspaceId}:`)) keep.add(key.slice(workspaceId.length + 1))
  }

  const overriddenFolders = rootFolders?.filter(folder => folderFilters[folder.id] !== undefined) ?? []
  const overriddenIds = new Set(overriddenFolders.map(folder => folder.id))
  const belongsTo = (entry: WorkspaceEntry, folderId: string) =>
    entry.id === folderId || entry.id.startsWith(`${folderId}/`)
  const outsideOverrides = overriddenFolders.length === 0
    ? entries
    : entries.filter(entry => !overriddenFolders.some(folder => belongsTo(entry, folder.id)))
  const filtered = overriddenFolders.length === 0
    ? applyFilter(entries, filter, keep)
    : [
      ...applyFilter(outsideOverrides, filter, new Set([...keep].filter(id => !overriddenIds.has(id)))),
      ...overriddenFolders.flatMap(folder => {
        const subtree = entries.filter(entry => belongsTo(entry, folder.id))
        const subtreeKeep = new Set([...keep].filter(id =>
          id === folder.id || id.startsWith(`${folder.id}/`)))
        return applyFilter(subtree, folderFilters[folder.id] ?? DEFAULT_FOLDER_FILTER, subtreeKeep)
      }),
    ]
  const tree = filterTreeByQuery(buildWorkspaceTree(filtered, connections, pins), query)
  return {
    tree,
    folders: entries.filter((entry) => entry.isDir).map((entry) => ({
      id: entry.id,
      name: entry.name,
      parentId: entry.id.includes('/') ? entry.id.slice(0, entry.id.lastIndexOf('/')) : undefined,
    })),
    files: filtered.filter((entry) => !entry.isDir),
  }
}
