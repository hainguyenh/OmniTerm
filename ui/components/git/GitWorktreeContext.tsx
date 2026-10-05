import { CornerUpLeft } from 'lucide-react'

import type { GitWorktreeInfo } from './gitTypes'
import { getActiveWorktree, getWorktreeHead, getWorktreeName } from './gitWorktreePresentation'

interface GitWorktreeContextProps {
  worktrees: GitWorktreeInfo[]
  activePath: string | null
  onSelectWorktree: (path: string) => void
}

export function GitWorktreeContext({ worktrees, activePath, onSelectWorktree }: GitWorktreeContextProps) {
  const active = getActiveWorktree(worktrees, activePath)
  const main = worktrees.find((worktree) => worktree.is_main && !worktree.is_prunable)
  if (worktrees.length < 2 || !active) return null

  return (
    <div className="git-checkout-context" role="group" aria-label="Active Git checkout" aria-live="polite">
      <span className="git-checkout-context-label">Viewing changes in</span>
      <strong>{getWorktreeName(active)}</strong>
      <span className="git-checkout-tag">{active.is_main ? 'Main checkout' : 'Worktree'}</span>
      <span className="git-checkout-context-branch">{getWorktreeHead(active)}</span>
      {!active.is_main && main && (
        <button type="button" onClick={() => onSelectWorktree(main.path)} className="git-checkout-back">
          <CornerUpLeft aria-hidden="true" />Back to main checkout
        </button>
      )}
      <span className="git-checkout-path" title={active.path}>{active.path}</span>
    </div>
  )
}
