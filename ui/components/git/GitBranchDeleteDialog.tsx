import { Loader2, Trash2, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import type { PendingBranchDelete } from './useGitBranchOps'
import './git-branch-dialog.css'

/**
 * Confirms a branch delete that needs more than `git branch -d`: one whose worktree goes with it,
 * or one git refused (unmerged commits, a dirty worktree), which the user may then force.
 */
export function GitBranchDeleteDialog({ pending, busy, onConfirm, onClose }: {
  pending: PendingBranchDelete
  busy: boolean
  onConfirm: (force: boolean) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const { branch, worktreePath, error } = pending
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.querySelector<HTMLButtonElement>('footer button')?.focus()
    return () => previous?.focus()
  }, [])

  return (
    <div className="git-branch-submodal-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div
        ref={dialogRef}
        className="git-branch-dialog git-menu"
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${branch}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <header><span className="git-branch-eyebrow">DELETE BRANCH</span><button type="button" className="git-icon-button" aria-label="Close delete dialog" onClick={onClose}><X /></button></header>
        <h2>Delete {branch}?</h2>
        {worktreePath && <div className="git-branch-preview-note" role="note">
          <strong>Worktree removed too</strong>
          <p>{branch} is checked out in the worktree at {worktreePath}. Deleting the branch removes that folder.</p>
        </div>}
        {error && <div className="git-branch-preview-note" role="alert">
          <strong>Not deleted</strong>
          <p>{error}</p>
          <p>Force delete discards unmerged commits{worktreePath ? ' and uncommitted changes in the worktree' : ''}.</p>
        </div>}
        <footer>
          <button type="button" className="git-control" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="git-control git-danger" disabled={busy} onClick={() => onConfirm(Boolean(error))}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}{error ? 'Force delete' : 'Delete'}
          </button>
        </footer>
      </div>
    </div>
  )
}
