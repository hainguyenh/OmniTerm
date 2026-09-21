import type { Workspace } from '@omniterm/contract'
import { pickShell, shellLabel, type ShellOption } from '../shellOptions'
import { decodeWorkspaceSelection } from './workspaceSelection'

/** Human-readable prediction for the next quick terminal launch. */
export function newTerminalHoverText(
  shellOptions: ShellOption[],
  requestedShell: string | undefined,
  workspaces: Workspace[],
  selectedWorkspaceId: string | null,
  homeDir: string,
): string {
  const shellId = pickShell(shellOptions, requestedShell)
  const shell = shellLabel(shellOptions, shellId)
  const selection = decodeWorkspaceSelection(selectedWorkspaceId)
  const workspace = selection ? workspaces.find(item => item.id === selection.workspaceId) : undefined
  const folder = selection?.folderId
    ? workspace?.folders.find(item => item.id === selection.folderId)
    : workspace?.folders[0]
  const directory = folder?.path || homeDir || 'home directory'
  return `Open ${shell} in ${directory}`
}
