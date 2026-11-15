import { useEffect } from 'react'

import { invoke } from '@tauri-apps/api/core'

import { commands, isTauri, type ProjectInfo } from '../ide/platform/ipc'
import { useProject } from '../ide/platform/project'
import { confirmProjectTrust } from '../ide/platform/projectTrust'

import { useWorkspaceStore } from './workspaceStore'

/**
 * The workbench keeps one "project" in `useProject`. OmniTerm has workspaces of several
 * folders, so the active workspace is that project: the backend (`ide_set_project`) opens a single
 * folder as the project and several folders as a container workspace, and answers with
 * the `ProjectInfo` the workbench expects.
 */

let availability: Promise<boolean> | null = null

/**
 * Whether the workbench backend answers. The first caller probes with a cheap read; everyone
 * shares the result, so a webview opened against an older backend degrades once, not per call.
 */
export function probeIdeBackend(): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false)
  availability ??= commands.settingsGet().then(() => true, () => false)
  return availability
}

let generation = 0

/** A switch that answers sooner than this never shows the opening view (no flash on startup). */
export const OPENING_DELAY_MS = 150

/** What the opening view names: the workspace's first folder, else its name. */
function openingTarget(workspaceId: string | null): string | null {
  if (!workspaceId) return null
  const workspace = useWorkspaceStore.getState().workspaces.find((item) => item.id === workspaceId)
  return workspace?.folders?.[0]?.path ?? workspace?.name ?? workspaceId
}

/**
 * Asks, like the IDE's Open Project, whether to trust each folder of the workspace that has no
 * decision yet ("Trust and Open Project?"). A folder already decided is not asked again. Choosing
 * Don't Open rejects with a `cancelled` error, and the workspace's project is not opened.
 */
async function confirmWorkspaceTrust(workspaceId: string | null): Promise<void> {
  if (!workspaceId) return
  const workspace = useWorkspaceStore.getState().workspaces.find((item) => item.id === workspaceId)
  for (const folder of workspace?.folders ?? []) await confirmProjectTrust(folder.path, 'local')
}

/**
 * Makes `workspaceId` (or no workspace) the workbench project and publishes it to `useProject`.
 * A newer call wins: a slow answer for a workspace the user already left is dropped. While the
 * backend opens the project, `useProject` carries the same `opening` / `openingPath` state as a
 * regular project open, so the workbench shows its opening view (after a short delay).
 */
export async function syncProject(workspaceId: string | null): Promise<ProjectInfo | null> {
  const mine = ++generation
  if (!(await probeIdeBackend())) return null
  await confirmWorkspaceTrust(workspaceId)
  if (mine !== generation) return null
  const target = openingTarget(workspaceId)
  const timer = target
    ? setTimeout(() => {
        if (mine === generation) useProject.setState({ opening: true, openingPath: target })
      }, OPENING_DELAY_MS)
    : undefined
  try {
    const project = await invoke<ProjectInfo | null>('ide_set_project', { workspaceId })
    if (mine !== generation) return project
    useProject.setState(project
      ? { project, settings: project.settings, lightEdit: false }
      : { project: null, lightEdit: false })
    return project
  } finally {
    clearTimeout(timer)
    // Only the newest call owns the opening state; an older one finishing must not clear it.
    if (mine === generation) useProject.setState({ opening: false, openingPath: null })
  }
}

/**
 * Keeps the workbench project in step with the workspace the OmniTerm window has selected.
 * `foldersKey` changes when a folder is added to or removed from that workspace, which reopens it.
 */
export function useProjectBridge(workspaceId: string | null, foldersKey = ''): void {
  useEffect(() => {
    void syncProject(workspaceId).catch(() => {
      // A workspace whose folders are gone has no project; the workbench then shows none.
      useProject.setState({ project: null })
    })
  }, [workspaceId, foldersKey])
}
