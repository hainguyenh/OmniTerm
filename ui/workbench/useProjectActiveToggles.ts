import { useEffect } from 'react'

import { rootToggleKey, setRootToggles } from '../ide/features/project-tree/rootToggle'
import { useSelectedWorkspace } from '../platform/workspaceStore'

import { comparablePath, useProjectFilterStore } from './projectFilterStore'
import { activeFolders, setFolderDisabled, workspaceFolderAt } from './titlebar/workspaceActions'

/**
 * Gives each project root of a multi-project workspace an "active" checkbox, a default-project
 * star and hover actions. Every folder stays in the tree: a switched-off one shows unchecked and
 * greyed out, and checking it switches it on again (the choice is stored on the workspace, so it
 * persists). The last active project cannot be switched off. The default project is the one chosen
 * for the workspace, else its first active project.
 */
export function useProjectActiveToggles(): void {
  const workspace = useSelectedWorkspace()
  const chosenDefault = useProjectFilterStore((s) => (workspace ? s.defaults[workspace.id] : undefined))
  useEffect(() => {
    if (!workspace || workspace.folders.length < 2) {
      setRootToggles(new Map(), null)
      return undefined
    }
    const active = activeFolders(workspace)
    const checked = new Map(workspace.folders.map((folder) => [rootToggleKey(folder.path), !folder.disabled]))
    const chosen = chosenDefault
      ? workspace.folders.find((folder) => comparablePath(folder.path) === comparablePath(chosenDefault))
      : undefined
    const defaultPath = chosen?.path ?? active[0]?.path ?? null
    setRootToggles(
      checked,
      {
        toggle: (path) => {
          const folder = workspaceFolderAt(workspace, path)
          if (!folder) return
          if (folder.disabled) void setFolderDisabled(workspace.id, folder, false)
          else if (active.length > 1) void setFolderDisabled(workspace.id, folder, true)
        },
        setDefault: (path) => {
          const folder = workspaceFolderAt(workspace, path)
          if (folder) useProjectFilterStore.getState().setDefaultProject(workspace.id, folder.path)
        },
        openTerminal: (path) => {
          window.dispatchEvent(new CustomEvent('omniterm:new-session', { detail: { cwd: path } }))
        },
      },
      defaultPath,
    )
    return () => setRootToggles(new Map(), null)
  }, [workspace, chosenDefault])
}
