import type { Dispatch, SetStateAction } from 'react'

import { GitBlameModal } from '../git/GitBlameModal'
import { GitBranchCompareModal } from '../git/GitBranchCompareModal'
import { GitDiffViewer } from '../git/GitDiffViewer'
import { GitFileHistoryModal } from '../git/GitFileHistoryModal'
import type { GitFileContext } from '../git/gitTypes'
import type { EditorGitDialog } from './editorGitActions'

interface EditorGitDialogsProps {
  context: GitFileContext
  dialog: EditorGitDialog | null
  setDialog: Dispatch<SetStateAction<EditorGitDialog | null>>
  /** The branch diff may have written the file; the editor re-reads it if it holds no edits. */
  onDiffClosed: () => void
}

/**
 * The editor's Git dialogs, reusing the Git view's own modals. Rendered outside the editor's DOM
 * subtree by the host so key presses inside a dialog never reach the editor's Ctrl+S handler.
 */
export function EditorGitDialogs({ context, dialog, setDialog, onDiffClosed }: EditorGitDialogsProps) {
  const cwd = context.repo_root
  const filePath = context.relative_path
  const close = () => setDialog(null)

  if (dialog?.type === 'history') {
    return <GitFileHistoryModal cwd={cwd} filePath={filePath} range={dialog.range} onClose={close} />
  }
  if (dialog?.type === 'blame') {
    return <GitBlameModal cwd={cwd} filePath={filePath} onClose={close} />
  }
  if (dialog?.type === 'compare') {
    return (
      <GitBranchCompareModal
        cwd={cwd}
        filePath={filePath}
        currentBranch={context.branch}
        onSelectBranch={(branch) => setDialog({ type: 'diff', branch })}
        // The picker closes itself right after a selection; only close it if it is still what is open.
        onClose={() => setDialog((current) => (current?.type === 'compare' ? null : current))}
      />
    )
  }
  if (dialog?.type === 'diff') {
    return (
      <GitDiffViewer
        cwd={cwd}
        filePath={filePath}
        staged={false}
        targetBranch={dialog.branch}
        onClose={() => {
          close()
          onDiffClosed()
        }}
      />
    )
  }
  return null
}
