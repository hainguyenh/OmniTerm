import type { Workspace } from '../domain'

import { notifications } from '../ide/workbench/contributions'
import { decodeWorkspaceSelection } from '../utils/workspaceSelection'

const comparable = (path: string): string => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()

/**
 * The id of the selected workspace when `cwd` is one of its folders or inside one; null otherwise
 * (the session is then matched to a workspace by its folder alone). `selection` is the raw
 * selection, which names a folder too (`<workspace>::<folder>`) after the new-terminal menu picked one.
 */
export function workspaceHolding(
  workspaces: readonly Workspace[],
  selection: string | null | undefined,
  cwd: string | null | undefined,
): string | null {
  const selectedWorkspaceId = decodeWorkspaceSelection(selection ?? null)?.workspaceId
  if (!selectedWorkspaceId || !cwd) return null
  const selected = workspaces.find((workspace) => workspace.id === selectedWorkspaceId)
  if (!selected) return null
  const target = comparable(cwd)
  const holds = selected.folders.some((folder) => {
    const root = comparable(folder.path)
    return target === root || target.startsWith(`${root}/`)
  })
  return holds ? selected.id : null
}

/** Tells the user a session did not start, instead of only logging it. */
export function reportSessionStartFailure(error: unknown): void {
  const reason = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  notifications().notify({ level: 'error', title: reason ? `Could not start the session: ${reason}` : 'Could not start the session.' })
}
