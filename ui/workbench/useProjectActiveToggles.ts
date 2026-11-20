import { useEffect } from 'react'

import { rootToggleKey, setRootToggles } from '../ide/features/project-tree/rootToggle'
import { useSelectedWorkspace } from '../platform/workspaceStore'

import { comparablePath, useProjectFilterStore } from './projectFilterStore'
import { offerToIndexDefault, offerToIndexOnOpen } from './projectIndexing'
import { activeFolders, setFolderDisabled, workspaceFolderAt } from './titlebar/workspaceActions'

/** How long after a workspace opens the "not indexed" notification waits. */
const INDEX_OFFER_DELAY_MS = 3_000

/**
 * Gives each project root of a multi-project workspace an "active" toggle, a default-project
 * star (click to set or unset) and an open-terminal action. Every folder stays in the tree: a switched-off one shows unchecked and
 * greyed out, and checking it switches it on again (the choice is stored on the workspace, so it
 * persists). The last active project cannot be switched off. The default project is the one chosen
 * for the workspace, else its first active project.
 */
export function useProjectActiveToggles(): void {
  const workspace = useSelectedWorkspace()
  const chosenDefault = useProjectFilterStore((s) => (workspace ? s.defaults[workspace.id] : undefined))
  // Nothing is indexed on its own: once start-up has settled, offer to index the default project.
  useEffect(() => {
    if (!workspace) return undefined
    const timer = setTimeout(() => offerToIndexOnOpen(workspace), INDEX_OFFER_DELAY_MS)
    return () => clearTimeout(timer)
  }, [workspace])
  useEffect(() => {
    if (!workspace || workspace.folders.length < 2) {
      setRootToggles(new Map(), null)
      return undefined
    }
    const active = activeFolders(workspace)
    const checked = new Map(workspace.folders.map((folder) => [rootToggleKey(folder.path), !folder.disabled]))
    // A switched-off project is never the default: the first active one stands in for it.
    const chosen = chosenDefault
      ? active.find((folder) => comparablePath(folder.path) === comparablePath(chosenDefault))
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
          if (!folder) return
          useProjectFilterStore.getState().setDefaultProject(workspace.id, folder.path)
          void offerToIndexDefault(workspace, folder.path)
        },
        clearDefault: () => useProjectFilterStore.getState().clearDefaultProject(workspace.id),
        openTerminal: (path) => {
          window.dispatchEvent(new CustomEvent('omniterm:new-session', { detail: { cwd: path } }))
        },
      },
      defaultPath,
    )
    return () => setRootToggles(new Map(), null)
  }, [workspace, chosenDefault])
}
