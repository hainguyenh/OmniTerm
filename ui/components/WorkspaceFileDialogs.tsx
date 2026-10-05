import type { Workspace, WorkspaceEntry } from '@omniterm/contract'

import type { WorkspaceFileActions } from '../hooks/useWorkspaceFileActions'
import { moveDestinations, parentPath } from '../utils/workspaceFileEdits'
import ConfirmDialog from './ConfirmDialog'
import { CreateFileDialog } from './CreateFileDialog'
import { CreateFolderDialog } from './CreateFolderDialog'
import { MoveFileDialog } from './MoveFileDialog'

interface WorkspaceFileDialogsProps {
  actions: WorkspaceFileActions
  workspaces: Workspace[]
  entriesOf: (workspaceId: string) => WorkspaceEntry[]
}

/** Whichever tree edit dialog `useWorkspaceFileActions` has open, if any. */
export function WorkspaceFileDialogs({ actions, workspaces, entriesOf }: WorkspaceFileDialogsProps) {
  const { createFile, createFolder, moveTarget, deleteTarget } = actions
  return (
    <>
      {createFile && (
        <CreateFileDialog
          workspaceId={createFile.workspaceId}
          folderPath={createFile.folderPath}
          folderName={createFile.folderName}
          onClose={actions.closeNewFile}
          onCreated={actions.fileCreated}
        />
      )}
      {createFolder && (
        <CreateFolderDialog
          parentName={createFolder.name}
          onClose={actions.closeNewFolder}
          onCreate={actions.createFolderNamed}
        />
      )}
      {moveTarget && (
        <MoveFileDialog
          fileName={moveTarget.name}
          currentFolder={parentPath(moveTarget.path)}
          destinations={moveDestinations(
            workspaces.find(workspace => workspace.id === moveTarget.workspaceId)?.folders ?? [],
            entriesOf(moveTarget.workspaceId),
          )}
          onClose={actions.closeMoveFile}
          onMove={actions.moveFileTo}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete file?"
          message={`Permanently delete "${deleteTarget.name}" from disk? This cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          onConfirm={actions.confirmDelete}
          onCancel={actions.cancelDelete}
        />
      )}
    </>
  )
}
