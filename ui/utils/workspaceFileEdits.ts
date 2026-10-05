import type { WorkspaceEntry, WorkspaceFolder } from '@omniterm/contract'

/** A file or folder the tree's menus act on: its logical path plus the name shown for it. */
export interface WorkspaceTreeTarget {
  workspaceId: string
  path: string
  name: string
}

/** A folder a file can be moved into, labelled the way the tree shows it. */
export interface MoveDestination {
  /** Folder-namespaced logical path. */
  id: string
  label: string
}

/** Logical path of the folder holding `path`, or `''` for a bare folder id. */
export function parentPath(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? '' : path.slice(0, cut)
}

export function childPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name
}

/** Every scanned folder, with its workspace folder id swapped for the folder's display name. */
export function moveDestinations(
  rootFolders: readonly WorkspaceFolder[],
  entries: readonly WorkspaceEntry[],
): MoveDestination[] {
  const names = new Map(rootFolders.map(folder => [folder.id, folder.name]))
  return entries
    .filter(entry => entry.isDir)
    .map(entry => {
      const slash = entry.id.indexOf('/')
      const rootId = slash < 0 ? entry.id : entry.id.slice(0, slash)
      const rest = slash < 0 ? '' : entry.id.slice(slash)
      return { id: entry.id, label: `${names.get(rootId) ?? rootId}${rest}` }
    })
    .sort((left, right) => left.label.localeCompare(right.label))
}

