import type { Workspace, WorkspaceFolder } from '../../domain'

import { diag } from '../../diag'
import { encodeWorkspaceSelection } from '../../utils/workspaceSelection'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { useProjectFilterStore } from '../projectFilterStore'

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

/** A path as both sides compare it: forward slashes, no trailing one, case-insensitive on Windows drives. */
const comparable = (path: string): string => {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '')
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized
}

/** The folder of `workspace` at `path` (as the Project view or the project filter names it). */
export function workspaceFolderAt(workspace: Workspace | null | undefined, path: string): WorkspaceFolder | null {
  const target = comparable(path)
  return workspace?.folders.find((folder) => comparable(folder.path) === target) ?? null
}

/**
 * Takes a project folder out of workspace `workspaceId` (its files are untouched); the project
 * bridge reopens the workspace with the folders that are left.
 */
export async function removeFolderFromWorkspace(workspaceId: string, folder: WorkspaceFolder): Promise<void> {
  try {
    await window.omnitermAPI.workspace.removeFolder(workspaceId, folder.id)
    const filter = useProjectFilterStore.getState()
    // The Project panel was showing only this folder: show the rest.
    if (filter.filter !== 'all' && comparable(filter.filter) === comparable(folder.path)) filter.reset()
    await useWorkspaceStore.getState().refresh()
  } catch (error) {
    diag.error('[workspace] could not remove a folder', error)
  }
}
