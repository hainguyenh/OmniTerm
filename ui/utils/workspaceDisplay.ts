import type { Workspace } from '@omniterm/contract'

export function workspaceLocationLabel(workspace: Workspace | undefined): string {
  if (!workspace) return 'No workspace selected'
  const folderNames = workspace.folders
    .map(folder => folder.name.trim())
    .filter(Boolean)
  return folderNames.length > 0
    ? `${workspace.name} - ${folderNames.join(', ')}`
    : workspace.name
}


/**
 * Resolve a live terminal cwd to pane/status chrome text.
 * Workspace folder names are user aliases, so the deepest matching alias wins over the basename.
 */
export function workingFolderLabel(cwd: string | undefined, workspaces: Workspace[]): string | undefined {
  if (!cwd) return undefined
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized) return undefined
  const windowsPath = /^[A-Za-z]:\//.test(normalized)
  const comparable = windowsPath ? normalized.toLowerCase() : normalized
  const matches = workspaces
    .flatMap(workspace => workspace.folders)
    .map(folder => {
      const root = folder.path.replace(/\\/g, '/').replace(/\/+$/, '')
      const comparableRoot = windowsPath ? root.toLowerCase() : root
      const inside = comparable === comparableRoot || comparable.startsWith(`${comparableRoot}/`)
      return inside ? { folder, length: comparableRoot.length } : null
    })
    .filter((item): item is { folder: Workspace['folders'][number]; length: number } => Boolean(item))
    .sort((a, b) => b.length - a.length)
  const alias = matches[0]?.folder.name.trim()
  if (alias) return alias
  return normalized.slice(normalized.lastIndexOf('/') + 1) || normalized
}
