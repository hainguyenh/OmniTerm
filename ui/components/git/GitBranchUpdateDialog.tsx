import { ArrowDownToLine, ArrowRight, GitBranch, Loader2, ShieldCheck, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { GitBranchInfo } from './gitTypes'
import './git-branch-update.css'

/**
 * Fast-forwards a branch that is not checked out to its upstream. Git refuses a diverged branch;
 * the refusal stays in the dialog so the user sees why nothing moved.
 */
export function GitBranchUpdateDialog({ branch, currentBranch, onUpdate, onClose }: {
  branch: GitBranchInfo
  currentBranch?: string
  /** Resolves to the error text, or null once the branch was updated. */
  onUpdate: (branchName: string) => Promise<string | null>
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const update = async () => {
    setRunning(true)
    setError(null)
    const failure = await onUpdate(branch.name)
    setRunning(false)
    if (failure) setError(failure)
    else onClose()
  }
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => previous?.focus()
  }, [])

  return (
    <div className="git-branch-submodal-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div
        ref={dialogRef}
        className="git-branch-update-dialog git-menu"
        role="dialog"
        aria-modal="true"
        aria-label={`Update ${branch.name} without checkout`}
        aria-describedby="git-update-description"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
          if (event.key === 'Tab') {
            const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
            const first = buttons?.[0]
            const last = buttons?.[buttons.length - 1]
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
            event.stopPropagation()
          }
        }}
      >
        <header><span className="git-branch-eyebrow">UPDATE WITHOUT CHECKOUT</span><button type="button" className="git-icon-button" aria-label="Close update dialog" onClick={onClose}><X /></button></header>
        <h2>Bring {branch.name} up to date</h2>
        <p id="git-update-description">Your working branch stays on <strong>{currentBranch ?? 'HEAD'}</strong>.</p>
        <div className="git-branch-update-route"><span><ArrowDownToLine />{branch.upstream ?? 'No upstream'}</span><ArrowRight /><span><GitBranch />{branch.name}</span></div>
        <div className="git-branch-update-policy"><ShieldCheck /><div><strong>Fast-forward only</strong><p>If branches have diverged, stop and review before updating.</p></div></div>
        {!branch.upstream && <div className="git-branch-preview-note" role="note"><strong>No upstream</strong><p>Set an upstream under “More branch tools” first.</p></div>}
        {error && <div className="git-branch-preview-note" role="alert"><strong>Not updated</strong><p>{error}</p></div>}
        <footer><button type="button" className="git-control" onClick={onClose}>Cancel</button><button type="button" className="git-control git-primary" disabled={running || !branch.upstream} onClick={() => void update()}>{running ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />}Update {branch.name}</button></footer>
      </div>
    </div>
  )
}
