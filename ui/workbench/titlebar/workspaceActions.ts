import type { Workspace } from '../../domain'

import { diag } from '../../diag'
import { encodeWorkspaceSelection } from '../../utils/workspaceSelection'
import { useWorkspaceStore } from '../../platform/workspaceStore'

/** Reads the catalog again and selects `workspace` (the one just added or imported). */
async function adopt(workspace: Workspace | null): Promise<void> {
  const { refresh, setSelection } = useWorkspaceStore.getState()
  await refresh()
  if (workspace) setSelection(encodeWorkspaceSelection(workspace.id))
}

/** Picks a folder and makes it a new workspace. Cancelling the picker changes nothing. */
export async function addWorkspaceFromFolder(): Promise<void> {
  try {
    await adopt(await window.omnitermAPI.workspace.add())
  } catch (error) {
    diag.error('[workspace] could not add a workspace', error)
  }
}

/** Imports a workspace file (VS Code `.code-workspace`) as a new workspace. */
export async function importWorkspaceFile(): Promise<void> {
  try {
    await adopt(await window.omnitermAPI.workspace.importFile())
  } catch (error) {
    diag.error('[workspace] could not import a workspace file', error)
  }
}

/** Creates an empty workspace named `name`. */
export async function createWorkspace(name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  try {
    await adopt(await window.omnitermAPI.workspace.create(trimmed))
  } catch (error) {
    diag.error('[workspace] could not create a workspace', error)
  }
}

/** Picks a folder to add to workspace `workspaceId`; the project bridge reopens it with the folder. */
export async function addFolderToWorkspace(workspaceId: string): Promise<void> {
  try {
    const updated = await window.omnitermAPI.workspace.addFolder(workspaceId)
    if (updated) await useWorkspaceStore.getState().refresh()
  } catch (error) {
    diag.error('[workspace] could not add a folder', error)
  }
}
