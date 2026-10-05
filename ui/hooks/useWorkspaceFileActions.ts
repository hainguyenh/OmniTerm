import { useCallback, useState } from 'react'
import type React from 'react'
import type { WorkspaceScript } from '@omniterm/contract'

import { childPath, parentPath, type WorkspaceTreeTarget } from '../utils/workspaceFileEdits'

type FailureReporter = (error: unknown, title?: string) => void

interface WorkspaceFileActionOptions {
  /** Reload workspace records; a rename, move or delete can carry a pin with it. */
  refresh: () => Promise<void>
  rescan: (workspaceId: string) => Promise<void>
  reportFailure: FailureReporter
  onOpenScript: (workspaceId: string, script: WorkspaceScript) => void
  setExpandedDirs: React.Dispatch<React.SetStateAction<Set<string>>>
}

export interface CreateFileRequest {
  workspaceId: string
  folderPath: string
  folderName?: string
}

/**
 * The workspace tree's file and folder edits: which dialog is open, and what each one does once
 * confirmed. Dialogs that can fail keep themselves open with the error, so their submit handlers
 * reject; one-shot actions report through `reportFailure` instead.
 */
export function useWorkspaceFileActions({
  refresh,
  rescan,
  reportFailure,
  onOpenScript,
  setExpandedDirs,
}: WorkspaceFileActionOptions) {
  const [createFile, setCreateFile] = useState<CreateFileRequest | null>(null)
  const [createFolder, setCreateFolder] = useState<WorkspaceTreeTarget | null>(null)
  const [moveTarget, setMoveTarget] = useState<WorkspaceTreeTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceTreeTarget | null>(null)

  const expand = useCallback((workspaceId: string, folder: string) => {
    const key = `${workspaceId}:${folder}`
    setExpandedDirs(previous => previous.has(key) ? previous : new Set(previous).add(key))
  }, [setExpandedDirs])

  const reload = useCallback((workspaceId: string, withPins: boolean) => {
    void (withPins ? refresh() : Promise.resolve())
      .then(() => rescan(workspaceId))
      .catch(error => reportFailure(error, 'Could not refresh the workspace'))
  }, [refresh, rescan, reportFailure])

  const fileCreated = useCallback((filePath: string, fileName: string) => {
    if (!createFile) return
    const { workspaceId } = createFile
    reload(workspaceId, false)
    const ext = fileName.includes('.') ? fileName.split('.').pop() || 'txt' : 'txt'
    onOpenScript(workspaceId, {
      id: filePath,
      name: fileName,
      path: filePath,
      kind: ext,
      viewable: true,
      editable: true,
    })
  }, [createFile, reload, onOpenScript])

  const createFolderNamed = useCallback(async (name: string) => {
    if (!createFolder) return
    const { workspaceId, path } = createFolder
    await window.omnitermAPI.workspace.createDirectory(workspaceId, childPath(path, name))
    expand(workspaceId, path)
    reload(workspaceId, false)
  }, [createFolder, expand, reload])

  const renameFile = useCallback((target: WorkspaceTreeTarget, name: string) => {
    const { workspaceId, path } = target
    void window.omnitermAPI.workspace.moveFile(workspaceId, path, childPath(parentPath(path), name))
      .then(() => reload(workspaceId, true))
      .catch(error => reportFailure(error, 'Could not rename file'))
  }, [reload, reportFailure])

  const moveFileTo = useCallback(async (folder: string) => {
    if (!moveTarget) return
    const { workspaceId, path, name } = moveTarget
    await window.omnitermAPI.workspace.moveFile(workspaceId, path, childPath(folder, name))
    expand(workspaceId, folder)
    reload(workspaceId, true)
  }, [moveTarget, expand, reload])

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return
    const { workspaceId, path } = deleteTarget
    setDeleteTarget(null)
    void window.omnitermAPI.workspace.deleteFile(workspaceId, path)
      .then(() => reload(workspaceId, true))
      .catch(error => reportFailure(error, 'Could not delete file'))
  }, [deleteTarget, reload, reportFailure])

  return {
    createFile,
    createFolder,
    moveTarget,
    deleteTarget,
    openNewFile: setCreateFile,
    openNewFolder: setCreateFolder,
    openMoveFile: setMoveTarget,
    requestDeleteFile: setDeleteTarget,
    closeNewFile: () => setCreateFile(null),
    closeNewFolder: () => setCreateFolder(null),
    closeMoveFile: () => setMoveTarget(null),
    cancelDelete: () => setDeleteTarget(null),
    fileCreated,
    createFolderNamed,
    renameFile,
    moveFileTo,
    confirmDelete,
  }
}

export type WorkspaceFileActions = ReturnType<typeof useWorkspaceFileActions>
