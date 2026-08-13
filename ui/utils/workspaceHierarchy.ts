import type { Workspace } from '@omniterm/contract'

export interface WorkspaceHierarchyNode {
  workspace: Workspace
  children: WorkspaceHierarchyNode[]
}

export interface WorkspaceSiblingPosition {
  parentId: string | null
  index: number
  count: number
}

export function buildWorkspaceForest(workspaces: readonly Workspace[]): WorkspaceHierarchyNode[] {
  const nodes = new Map(workspaces.map(workspace => [workspace.id, { workspace, children: [] as WorkspaceHierarchyNode[] }]))
  const roots: WorkspaceHierarchyNode[] = []
  for (const node of nodes.values()) {
    const parent = node.workspace.parentId ? nodes.get(node.workspace.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sort = (items: WorkspaceHierarchyNode[]) => {
    items.sort((a, b) => a.workspace.order - b.workspace.order || a.workspace.name.localeCompare(b.workspace.name))
    items.forEach(item => sort(item.children))
  }
  sort(roots)
  return roots
}

export function siblingPosition(
  workspaces: readonly Workspace[],
  workspaceId: string,
): WorkspaceSiblingPosition | null {
  const workspace = workspaces.find(item => item.id === workspaceId)
  if (!workspace) return null
  const siblings = workspaces
    .filter(item => item.parentId === workspace.parentId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  const index = siblings.findIndex(item => item.id === workspaceId)
  if (index < 0) return null
  return { parentId: workspace.parentId ?? null, index, count: siblings.length }
}

export function workspacePinTarget(logicalPath: string): { folderId: string; path: string } | null {
  const trimmed = logicalPath.replace(/^\/+|\/+$/g, '')
  if (!trimmed) return null
  const slash = trimmed.indexOf('/')
  return slash < 0
    ? { folderId: trimmed, path: '' }
    : { folderId: trimmed.slice(0, slash), path: trimmed.slice(slash + 1) }
}

export function workspaceDropIndex(
  workspaces: readonly Workspace[],
  sourceId: string,
  targetId: string,
  side: 'before' | 'after',
): { parentId: string | null; index: number } | null {
  const source = siblingPosition(workspaces, sourceId)
  const target = siblingPosition(workspaces, targetId)
  if (!source || !target) return null
  let index = target.index + (side === 'after' ? 1 : 0)
  if (source.parentId === target.parentId && source.index < index) index -= 1
  return { parentId: target.parentId, index }
}


export interface OrderedWorkspaceRow {
  workspace: Workspace
  depth: number
}

export function orderedWorkspaceRows(workspaces: readonly Workspace[]): OrderedWorkspaceRow[] {
  const rows: OrderedWorkspaceRow[] = []
  const visit = (node: WorkspaceHierarchyNode, depth: number) => {
    rows.push({ workspace: node.workspace, depth })
    node.children.forEach(child => visit(child, depth + 1))
  }
  buildWorkspaceForest(workspaces).forEach(node => visit(node, 0))
  return rows
}

export function terminalWorkspaceSelection(
  workspaces: readonly Workspace[],
  currentId: string | null,
): string | null {
  const ordered = orderedWorkspaceRows(workspaces).map(row => row.workspace)
  const current = ordered.find(workspace => workspace.id === currentId)
  if (current?.folders?.length === 1) return current.id
  return ordered.find(workspace => workspace.folders?.length === 1)?.id ?? null
}
