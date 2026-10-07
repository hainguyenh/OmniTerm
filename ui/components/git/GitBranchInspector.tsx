import { ArrowDownToLine, ArrowRight, GitBranch, GitCommitHorizontal, Radio, Star, UserRound } from 'lucide-react'

import { GitBranchSubmenu } from './GitBranchSubmenu'
import { GitBranchTools, type GitBranchToolActions } from './GitBranchTools'
import type { GitBranchInfo } from './gitTypes'
import './git-branch-inspector.css'

interface GitBranchInspectorProps {
  branch: GitBranchInfo | null
  currentBranch?: string
  busy: boolean
  remoteBranches: string[]
  tools: GitBranchToolActions
  isFavorite?: boolean
  onToggleFavorite?: (name: string) => void
  onCheckout: (name: string) => void
  onPull: (name: string) => void
  onMerge: (name: string) => void
  onRebase: (name: string) => void
  onCompare: (name: string) => void
  onNewBranchFrom: (name: string) => void
  onDelete: (name: string) => void
}

export function GitBranchInspector({
  branch,
  currentBranch,
  busy,
  remoteBranches,
  tools,
  isFavorite,
  onToggleFavorite,
  ...actions
}: GitBranchInspectorProps) {
  if (!branch) return <aside className="git-branch-inspector git-branch-empty">
    <GitBranch />
    <h2>Your branches, in focus</h2>
    <p>Select a branch to inspect its tracking status and choose an action.</p>
    <span>Right-click a branch for quick actions.</span>
  </aside>

  const isCurrent = branch.is_current || branch.name === currentBranch
  return (
    <aside className="git-branch-inspector" aria-label="Selected branch details">
      <div className="git-branch-detail-heading">
        <span className="git-branch-eyebrow">{branch.is_remote ? 'REMOTE BRANCH' : 'LOCAL BRANCH'}</span>
        <div className="flex items-center justify-between gap-2">
          <h2><GitBranch />{branch.name}</h2>
          {onToggleFavorite && (
            <button
              type="button"
              className={`git-icon-button ${isFavorite ? 'text-amber-400' : 'text-theme-dim hover:text-amber-400'}`}
              aria-label={isFavorite ? `Remove ${branch.name} from favorites` : `Add ${branch.name} to favorites`}
              title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              onClick={() => onToggleFavorite(branch.name)}
            >
              <Star className={`w-4 h-4 ${isFavorite ? 'fill-amber-400' : ''}`} />
            </button>
          )}
        </div>
        {isCurrent && <span className="git-branch-current"><Radio />Checked out</span>}
      </div>
      <dl className="git-branch-tracking">
        <div><dt>Tracking</dt><dd>{branch.upstream ?? (branch.is_remote ? 'Remote reference' : 'No upstream')}</dd></div>
        <div><dt>Sync status</dt><dd>{branch.is_gone ? 'Upstream removed' : !branch.upstream ? 'Not tracked' : branch.ahead || branch.behind ? `${branch.ahead} ahead · ${branch.behind} behind` : 'Up to date'}</dd></div>
      </dl>
      <div className="git-branch-last-commit">
        <span className="git-branch-eyebrow">LAST COMMIT</span>
        <p><GitCommitHorizontal />{branch.last_commit_message ?? 'Commit details unavailable'}</p>
        {branch.last_commit_author && <small><UserRound />{branch.last_commit_author}</small>}
      </div>
      {!branch.is_remote && !isCurrent && branch.upstream && <div className="git-branch-update-card">
        <span className="git-branch-eyebrow">STAY ON {currentBranch ?? 'HEAD'}</span>
        <h3>Pull without checkout</h3>
        <p>Fast-forward {branch.name} to {branch.upstream} while keeping your current checkout. To bring it into {currentBranch ?? 'HEAD'}, merge it.</p>
        <button
          type="button"
          className="git-control"
          disabled={busy}
          onClick={() => actions.onPull(branch.name)}
          aria-label={`Pull ${branch.name}`}
        >
          <ArrowDownToLine />Pull {branch.name}<ArrowRight />
        </button>
      </div>}
      <div className="git-branch-action-heading"><span className="git-branch-eyebrow">BRANCH ACTIONS</span></div>
      <fieldset className="git-branch-actions" disabled={busy}>
        <GitBranchSubmenu
          branch={branch}
          currentBranch={currentBranch}
          inline
          compact
          isFavorite={isFavorite}
          onToggleFavorite={onToggleFavorite}
          {...actions}
          onClose={() => { /* Inspector stays open between actions. */ }}
        />
      </fieldset>
      <GitBranchTools key={`${branch.is_remote}:${branch.name}`} branch={branch} isCurrent={isCurrent} remoteBranches={remoteBranches} busy={busy} {...tools} />
    </aside>
  )
}
