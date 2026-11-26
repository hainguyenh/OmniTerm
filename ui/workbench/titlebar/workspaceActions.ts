import type { Workspace, WorkspaceColor, WorkspaceFolder, WorkspaceIcon } from '../../domain'

import { diag } from '../../diag'
import { encodeWorkspaceSelection } from '../../utils/workspaceSelection'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { notifications } from '../../ide/workbench/contributions'
import { invalidateProjectIndex } from '../../utils/projectIndexer'
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

/** Saves `workspace` as a VS Code `.code-workspace` file the user picks the place of. */
export async function exportWorkspaceFile(workspace: Workspace): Promise<void> {
  try {
    const path = await window.omnitermAPI.workspace.exportFile(workspace.id, workspace.name)
    if (path) notifications().notify({ level: 'info', title: `Workspace saved to ${path}` })
  } catch (error) {
    diag.error('[workspace] could not export the workspace', error)
    notifications().notify({ level: 'error', title: 'Could not save the workspace file', body: error instanceof Error ? error.message : String(error) })
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

/** Gives workspace `workspace` a new name (asked for); an empty or unchanged name does nothing. */
export async function renameWorkspace(workspace: Workspace, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed || trimmed === workspace.name) return
  try {
    await window.omnitermAPI.workspace.rename(workspace.id, trimmed)
    await useWorkspaceStore.getState().refresh()
  } catch (error) {
    diag.error('[workspace] could not rename the workspace', error)
  }
}

/** Removes a workspace from OmniTerm; its folders stay on disk. The caller confirms first. */
export async function removeWorkspace(workspace: Workspace): Promise<void> {
  try {
    await window.omnitermAPI.workspace.remove(workspace.id)
    invalidateProjectIndex(workspace.id)
    await useWorkspaceStore.getState().refresh()
  } catch (error) {
    diag.error('[workspace] could not remove the workspace', error)
  }
}

/** Sets the colour and icon that stand for a workspace; `undefined` clears one. */
export async function setWorkspaceAppearance(workspace: Workspace, color?: WorkspaceColor, icon?: WorkspaceIcon): Promise<void> {
  try {
    await window.omnitermAPI.workspace.setAppearance(workspace.id, color, icon)
    await useWorkspaceStore.getState().refresh()
  } catch (error) {
    diag.error('[workspace] could not set the workspace appearance', error)
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

/** The folders of `workspace` that are switched on: the project the workbench opens. */
export const activeFolders = (workspace: Workspace | null | undefined): WorkspaceFolder[] =>
  (workspace?.folders ?? []).filter((folder) => !folder.disabled)

/**
 * Switches a project folder off or on without removing it. A disabled folder stays in the
 * workspace but is left out of the project, so the tree, search, index and scans skip it; the
 * project bridge reopens the workspace with the folders that are on.
 */
export async function setFolderDisabled(workspaceId: string, folder: WorkspaceFolder, disabled: boolean): Promise<void> {
  try {
    await window.omnitermAPI.workspace.setFolderDisabled(workspaceId, folder.id, disabled)
    // The search index was built with the old set of projects.
    invalidateProjectIndex(workspaceId)
    const filter = useProjectFilterStore.getState()
    // The Project panel was showing only this folder: it is gone from the project now.
    if (disabled && filter.filter !== 'all' && comparable(filter.filter) === comparable(folder.path)) filter.reset()
    // A switched-off project cannot be where new terminals start: the first active one takes over.
    const chosenDefault = filter.defaults[workspaceId]
    if (disabled && chosenDefault && comparable(chosenDefault) === comparable(folder.path)) {
      filter.clearDefaultProject(workspaceId)
    }
    await useWorkspaceStore.getState().refresh()
  } catch (error) {
    diag.error('[workspace] could not switch a folder on or off', error)
  }
}

/** Switches every folder of the workspace on again, one reopen at the end. */
export async function enableAllFolders(workspace: Workspace): Promise<void> {
  try {
    for (const folder of workspace.folders.filter((item) => item.disabled)) {
      await window.omnitermAPI.workspace.setFolderDisabled(workspace.id, folder.id, false)
    }
    invalidateProjectIndex(workspace.id)
    await useWorkspaceStore.getState().refresh()
  } catch (error) {
    diag.error('[workspace] could not enable the folders', error)
  }
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
