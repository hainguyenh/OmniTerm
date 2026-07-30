import type { Connection, WorkspaceEntry, WorkspaceScript } from '@omniterm/contract'
import { isScriptEntry } from './workspaceFilter'

/**
 * A node in the workspace tree. Folders group their contents; leaves are either a file (carrying the
 * scanned entry, plus its `WorkspaceScript` view when it is runnable) or a connection profile saved
 * against that folder.
 *
 * Directories come from the scan's own `dir` entries, so a folder with nothing runnable in it still
 * appears — the earlier version synthesized folders from script paths and could not.
 */
export interface WorkspaceTreeNode {
  /** Display name (folder name, file name, or connection name). */
  name: string
  /** POSIX-relative path of this node; for a connection leaf, its connection id. */
  path: string
  isDir: boolean
  /** Present on file nodes. */
  entry?: WorkspaceEntry
  /** Present on runnable file nodes only — the record `workspace.run` / the editor expects. */
  script?: WorkspaceScript
  /** Present on connection nodes only. */
  connection?: Connection
  children: WorkspaceTreeNode[]
}

/** Back-compat alias: the flatten view and ScriptViewer still speak in "script tree" terms. */
export type ScriptTreeNode = WorkspaceTreeNode

/** Folders first, then connections, then files; each group in case-insensitive name order. */
function rank(node: WorkspaceTreeNode): number {
  if (node.isDir) return 0
  return node.connection ? 1 : 2
}

function sortNodes(nodes: WorkspaceTreeNode[]): void {
  nodes.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  for (const n of nodes) if (n.isDir) sortNodes(n.children)
}

/** The runnable view of an entry, or undefined when it is a folder or a plain file. */
export function entryScript(entry: WorkspaceEntry): WorkspaceScript | undefined {
  if (!isScriptEntry(entry)) return undefined
  return {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    kind: entry.kind,
    shell: entry.shell,
    editable: entry.editable ?? false,
  }
}

/**
 * Build the directory tree for one workspace from a flat entry list plus its saved connections.
 *
 * A connection's `parentId` holds the POSIX-relative path of the folder it belongs to (absent or
 * empty = the workspace root). A path that no longer exists — the folder was renamed or deleted since
 * the connection was saved — falls back to the root, so a connection can never become unreachable.
 */
export function buildWorkspaceTree(
  entries: WorkspaceEntry[],
  connections: Connection[] = [],
): WorkspaceTreeNode[] {
  const roots: WorkspaceTreeNode[] = []
  const dirs = new Map<string, WorkspaceTreeNode>()

  /** Folder node for `dirPath`, created (with its ancestors) if the scan did not list it. */
  const ensureDir = (dirPath: string): WorkspaceTreeNode | null => {
    if (dirPath === '') return null
    const existing = dirs.get(dirPath)
    if (existing) return existing
    const slash = dirPath.lastIndexOf('/')
    const name = slash === -1 ? dirPath : dirPath.slice(slash + 1)
    const parent = slash === -1 ? null : ensureDir(dirPath.slice(0, slash))
    const node: WorkspaceTreeNode = { name, path: dirPath, isDir: true, children: [] }
    dirs.set(dirPath, node)
    ;(parent ? parent.children : roots).push(node)
    return node
  }

  const parentOf = (id: string) => {
    const slash = id.lastIndexOf('/')
    return slash === -1 ? '' : id.slice(0, slash)
  }

  // Directories first so a file's parent is the scanned node (with its absolute path) rather than a
  // placeholder synthesized from the file's own id.
  for (const entry of entries) {
    if (!entry.isDir) continue
    const node = ensureDir(entry.id)
    if (node) node.entry = entry
  }

  for (const entry of entries) {
    if (entry.isDir) continue
    const parent = ensureDir(parentOf(entry.id))
    const leaf: WorkspaceTreeNode = {
      name: entry.name,
      path: entry.id,
      isDir: false,
      entry,
      script: entryScript(entry),
      children: [],
    }
    ;(parent ? parent.children : roots).push(leaf)
  }

  for (const connection of connections) {
    const parentPath = connection.parentId ?? ''
    const parent = parentPath && dirs.has(parentPath) ? dirs.get(parentPath)! : null
    const leaf: WorkspaceTreeNode = {
      name: connection.name,
      path: connection.id,
      isDir: false,
      connection,
      children: [],
    }
    ;(parent ? parent.children : roots).push(leaf)
  }

  sortNodes(roots)
  return roots
}

/** The text a search query is matched against for one node. */
function haystack(node: WorkspaceTreeNode): string {
  const conn = node.connection
  const target = conn && conn.type !== 'LOCAL' ? `${conn.user}@${conn.host}:${conn.port}` : ''
  return `${node.name} ${node.path} ${target}`.toLowerCase()
}

/**
 * Prune a tree to the nodes matching `query`, keeping a folder whose name matches (with all its
 * contents) or that has a matching descendant. An empty query returns the tree unchanged.
 */
export function filterTreeByQuery(
  nodes: WorkspaceTreeNode[],
  query: string,
): WorkspaceTreeNode[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return nodes

  const visit = (node: WorkspaceTreeNode): WorkspaceTreeNode | null => {
    const hit = haystack(node).includes(needle)
    if (!node.isDir) return hit ? node : null
    if (hit) return node
    const children = node.children.map(visit).filter((c): c is WorkspaceTreeNode => c !== null)
    return children.length ? { ...node, children } : null
  }

  return nodes.map(visit).filter((n): n is WorkspaceTreeNode => n !== null)
}

/**
 * Build a directory tree from a flat script list, without a directory scan.
 *
 * Kept for callers that only have `WorkspaceScript` records (a plugin WorkspaceProvider that
 * implements `scanScripts` but not `scanEntries`): a script whose `id` is `a/b/run.sh` produces
 * folder nodes `a` and `a/b`, so only folders that contain a script can appear.
 */
export function buildScriptTree(scripts: WorkspaceScript[]): WorkspaceTreeNode[] {
  return buildWorkspaceTree(
    scripts.map(script => ({
      id: script.id,
      name: script.name,
      path: script.path,
      isDir: false,
      kind: script.kind,
      shell: script.shell,
      editable: script.editable ?? false,
    })),
  )
}
