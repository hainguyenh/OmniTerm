import { useCallback } from 'react'
import type React from 'react'
import type { Workspace, WorkspaceColor, WorkspaceIcon } from '@omniterm/contract'
import { workspacePinTarget } from '../utils/workspaceHierarchy'

type FailureReporter = (error: unknown, title?: string) => void

interface WorkspaceMutationOptions {
  onWorkspacesChanged?: () => void | Promise<void>
  refresh: () => Promise<void>
  rescan: (workspaceId: string) => Promise<void>
  scanOnce: (workspaceId: string) => Promise<void>
  reportFailure: FailureReporter
  setExpandedId: React.Dispatch<React.SetStateAction<string | null>>
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>
}

export function useWorkspaceMutations({
  onWorkspacesChanged,
  refresh,
  rescan,
  scanOnce,
  reportFailure,
  setExpandedId,
  setWorkspaces,
}: WorkspaceMutationOptions) {
  const activateAddedWorkspace = useCallback(async (added: Workspace) => {
    await refresh()
    await onWorkspacesChanged?.()
    setExpandedId(added.id)
    void scanOnce(added.id)
  }, [onWorkspacesChanged, refresh, scanOnce, setExpandedId])

  const createWorkspace = useCallback(async (name: string) => {
    const created = await window.omnitermAPI.workspace.create(name)
    await activateAddedWorkspace(created)
  }, [activateAddedWorkspace])

  const addWorkspace = useCallback(async () => {
    const added = await window.omnitermAPI.workspace.add()
    if (added) await activateAddedWorkspace(added)
  }, [activateAddedWorkspace])

  const importWorkspace = useCallback(async () => {
    const added = await window.omnitermAPI.workspace.importFile()
    if (added) await activateAddedWorkspace(added)
  }, [activateAddedWorkspace])

  const addFolderToWorkspace = useCallback(async (workspaceId: string) => {
    const updated = await window.omnitermAPI.workspace.addFolder(workspaceId)
    if (!updated) return
    setWorkspaces(previous => previous.map(workspace => workspace.id === updated.id ? updated : workspace))
    await rescan(workspaceId)
    await onWorkspacesChanged?.()
  }, [onWorkspacesChanged, rescan, setWorkspaces])

  const removeFolderFromWorkspace = useCallback(async (workspaceId: string, folderId: string) => {
    const updated = await window.omnitermAPI.workspace.removeFolder(workspaceId, folderId)
    setWorkspaces(previous => previous.map(workspace => workspace.id === updated.id ? updated : workspace))
    await rescan(workspaceId)
    await onWorkspacesChanged?.()
  }, [onWorkspacesChanged, rescan, setWorkspaces])

  const removeWorkspace = useCallback(async (workspaceId: string) => {
    await window.omnitermAPI.workspace.remove(workspaceId)
    setExpandedId(previous => previous === workspaceId ? null : previous)
    await refresh()
    await onWorkspacesChanged?.()
  }, [onWorkspacesChanged, refresh, setExpandedId])

  const renameWorkspace = useCallback(async (workspaceId: string, name: string) => {
    try {
      const updated = await window.omnitermAPI.workspace.rename(workspaceId, name)
      setWorkspaces(previous => previous.map(workspace => workspace.id === updated.id ? updated : workspace))
      await onWorkspacesChanged?.()
    } catch (error) {
      reportFailure(error, 'Could not rename workspace')
    }
  }, [onWorkspacesChanged, reportFailure, setWorkspaces])

  const setWorkspaceAppearance = useCallback(async (
    workspaceId: string,
    color: WorkspaceColor | undefined,
    icon: WorkspaceIcon | undefined,
  ) => {
    try {
      const updated = await window.omnitermAPI.workspace.setAppearance(workspaceId, color, icon)
      setWorkspaces(previous => previous.map(workspace => workspace.id === updated.id ? updated : workspace))
      await onWorkspacesChanged?.()
    } catch (error) {
      reportFailure(error, 'Could not update workspace appearance')
    }
  }, [onWorkspacesChanged, reportFailure, setWorkspaces])

  const setWorkspaceFolderColor = useCallback(async (
    workspaceId: string,
    folderId: string,
    color: WorkspaceColor | undefined,
  ) => {
    try {
      const updated = await window.omnitermAPI.workspace.setFolderColor(workspaceId, folderId, color)
      setWorkspaces(previous => previous.map(workspace => workspace.id === updated.id ? updated : workspace))
      await onWorkspacesChanged?.()
    } catch (error) {
      reportFailure(error, 'Could not update folder color')
    }
  }, [onWorkspacesChanged, reportFailure, setWorkspaces])

  const moveWorkspace = useCallback((workspaceId: string, parentId: string | null, index: number) => {
    void window.omnitermAPI.workspace.move(workspaceId, parentId, index)
      .then(async updated => {
        setWorkspaces(updated)
        await onWorkspacesChanged?.()
      })
      .catch(error => reportFailure(error, 'Could not move workspace'))
  }, [onWorkspacesChanged, reportFailure, setWorkspaces])

  const isPinned = useCallback((workspace: Workspace, logicalPath: string) => {
    const target = workspacePinTarget(logicalPath)
    return Boolean(target && (workspace.pins ?? []).some(pin => pin.folderId === target.folderId && pin.path === target.path))
  }, [])

  const togglePinned = useCallback((workspace: Workspace, logicalPath: string) => {
    const target = workspacePinTarget(logicalPath)
    if (!target) return
    const pinned = (workspace.pins ?? []).some(pin => pin.folderId === target.folderId && pin.path === target.path)
    void window.omnitermAPI.workspace.setPinned(workspace.id, target.folderId, target.path, !pinned)
      .then(updated => setWorkspaces(previous => previous.map(item => item.id === updated.id ? updated : item)))
      .catch(error => reportFailure(error, 'Could not update pin'))
  }, [reportFailure, setWorkspaces])

  return {
    addFolderToWorkspace,
    removeFolderFromWorkspace,
    createWorkspace,
    addWorkspace,
    importWorkspace,
    isPinned,
    moveWorkspace,
    removeWorkspace,
    renameWorkspace,
    setWorkspaceAppearance,
    setWorkspaceFolderColor,
    togglePinned,
  }
}
