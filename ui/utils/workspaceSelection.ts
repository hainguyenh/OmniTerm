export interface WorkspaceSelection {
  workspaceId: string
  folderId: string | null
}

export function encodeWorkspaceSelection(workspaceId: string, folderId?: string | null): string {
  return folderId ? `${workspaceId}::${folderId}` : workspaceId
}

export function decodeWorkspaceSelection(value: string | null): WorkspaceSelection | null {
  if (!value) return null
  const separator = value.lastIndexOf('::')
  return separator > 0
    ? { workspaceId: value.slice(0, separator), folderId: value.slice(separator + 2) || null }
    : { workspaceId: value, folderId: null }
}

export function normalizeWorkspaceSelection(workspaces: readonly { id: string; folders?: Array<{ id: string }> }[], value: string | null): string | null {
  const previous = decodeWorkspaceSelection(value)
  const workspace = workspaces.find(item => item.id === previous?.workspaceId && item.folders?.length)
    ?? workspaces.find(item => item.folders?.length)
  if (!workspace?.folders?.[0]) return null
  const folder = workspace.folders.find(item => item.id === previous?.folderId) ?? workspace.folders[0]
  return encodeWorkspaceSelection(workspace.id, folder.id)
}
