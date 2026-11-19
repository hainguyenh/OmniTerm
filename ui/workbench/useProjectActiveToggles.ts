import { useEffect } from 'react'

import { rootToggleKey, setRootToggles } from '../ide/features/project-tree/rootToggle'
import { useSelectedWorkspace } from '../platform/workspaceStore'

import { activeFolders, setFolderDisabled, workspaceFolderAt } from './titlebar/workspaceActions'

/**
 * Gives each project root of a multi-project workspace an "active" checkbox. Only switched-on
 * projects are in the tree, so they show checked; unchecking one switches it off (the choice is
 * stored on the workspace, so it persists) and it moves to the header's list, where it can be
 * checked again. The last active project cannot be switched off.
 */
export function useProjectActiveToggles(): void {
  const workspace = useSelectedWorkspace()
  useEffect(() => {
    const active = activeFolders(workspace)
    if (!workspace || workspace.folders.length < 2) {
      setRootToggles(new Map(), null)
      return undefined
    }
    const checked = new Map(active.map((folder) => [rootToggleKey(folder.path), true]))
    setRootToggles(checked, (path) => {
      const folder = workspaceFolderAt(workspace, path)
      if (folder && active.length > 1) void setFolderDisabled(workspace.id, folder, true)
    })
    return () => setRootToggles(new Map(), null)
  }, [workspace])
}
