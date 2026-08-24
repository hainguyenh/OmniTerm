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

/**
 * Where new terminals land when the launch site does not name a workspace itself.
 * `folder` pins a specific folder inside its workspace; `home` means the system default.
 */
export type DefaultWorkspaceSetting =
  | { mode: 'workspace'; workspaceId: string }
  | { mode: 'folder'; workspaceId: string; folderId: string }
  | { mode: 'home' }

/** Selection-string form of a default-workspace setting, or null when the chain should skip it. */
export function defaultWorkspaceToSelection(setting: DefaultWorkspaceSetting | undefined): string | null {
  if (!setting || setting.mode === 'home') return null
  return setting.mode === 'folder'
    ? encodeWorkspaceSelection(setting.workspaceId, setting.folderId)
    : encodeWorkspaceSelection(setting.workspaceId)
}

/** Whether a selection still points at an existing workspace (and folder, when pinned). */
export function isSelectionLive(
  workspaces: readonly { id: string; folders?: Array<{ id: string }> }[],
  selection: string,
): boolean {
  const decoded = decodeWorkspaceSelection(selection)
  if (!decoded) return false
  const workspace = workspaces.find(item => item.id === decoded.workspaceId)
  if (!workspace) return false
  if (!decoded.folderId) return true
  return !!workspace.folders?.some(folder => folder.id === decoded.folderId)
}

/**
 * New-terminal workspace resolution order: explicit argument → default setting → last-used → home.
 * An explicit `null` is a forced home and short-circuits; `undefined` means "not specified" and
 * walks the chain. Candidates that no longer resolve against `isLive` fall through to the next
 * link instead of failing the launch.
 */
export function resolveNewSessionWorkspace(
  explicit: string | null | undefined,
  setting: DefaultWorkspaceSetting | undefined,
  lastUsed: string | null,
  isLive?: (selection: string) => boolean,
): string | null {
  if (explicit !== undefined) return explicit
  for (const candidate of [defaultWorkspaceToSelection(setting), lastUsed]) {
    if (candidate && (!isLive || isLive(candidate))) return candidate
  }
  return null
}
