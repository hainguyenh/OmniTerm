import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface GitBranchReviewEditorProps {
  branches: string[]
  forceDelete: boolean
  busy: boolean
  onForceDelete: (force: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}

export function GitBranchReviewEditor({ branches, forceDelete, busy, onForceDelete, onConfirm, onCancel }: GitBranchReviewEditorProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { headingRef.current?.focus() }, [])
  const branchLabel = branches.length === 1 ? 'branch' : 'branches'
  return (
    <section className="git-branch-review" aria-label="Cleanup plan editor">
      <div className="git-section-title">
        <Trash2 />
        <div>
          <h2 ref={headingRef} tabIndex={-1}>Review cleanup plan</h2>
          <p>{branches.length} local {branchLabel} selected for deletion</p>
        </div>
      </div>
      <div className="git-review-targets">
        {branches.map((name) => <div key={name}>
          <CheckCircle2 />
          <span title={name}>{name}</span>
        </div>)}
      </div>
      <label className="git-review-option">
        <input
          type="checkbox"
          checked={forceDelete}
          disabled={busy}
          onChange={(event) => onForceDelete(event.target.checked)}
        />
        <span>
          <strong>Force delete unmerged branches</strong>
          <small>Allow deletion even when Git detects unmerged commits.</small>
        </span>
      </label>
      <div className={`git-review-explanation ${forceDelete ? 'is-warning' : ''}`}>
        {forceDelete ? <AlertTriangle /> : <ShieldCheck />}
        <span>{forceDelete ? 'Unmerged work may be lost. Review each branch in the viewer before applying this plan.' : 'Git will refuse to delete branches with unmerged work. Active and primary branches are excluded from selection.'}</span>
      </div>
      <div className="git-review-actions">
        <button type="button" className="git-control" disabled={busy} onClick={onCancel}><ArrowLeft />Back to viewer</button>
        <button
          type="button"
          className="git-control git-delete-action"
          disabled={busy || branches.length === 0}
          onClick={onConfirm}
        >{busy ? <Loader2 className="animate-spin" /> : <Trash2 />}Delete {branches.length} {branchLabel}</button>
      </div>
    </section>
  )
}
