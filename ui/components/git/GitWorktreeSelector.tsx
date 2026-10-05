import { ChevronDown, FolderGit2, SquareStack } from 'lucide-react'
import { useCallback, useId, useRef, useState } from 'react'

import { GitWorktreeMenu } from './GitWorktreeMenu'
import type { GitWorktreeInfo } from './gitTypes'
import { getActiveWorktree, getWorktreeName } from './gitWorktreePresentation'
import './git-worktree.css'

interface GitWorktreeBadgeProps {
  /** Root of the main worktree the active checkout belongs to. */
  mainWorktree: string
  /** Icon only, for the session footer. */
  compact?: boolean
}

/** Marks that Git actions apply to a linked worktree rather than the repository's main checkout. */
export function GitWorktreeBadge({ mainWorktree, compact = false }: GitWorktreeBadgeProps) {
  const hint = `Linked worktree — changes, commits and branch actions apply here, not to the main checkout at ${mainWorktree}`
  return (
    <span
      className={`git-worktree-badge ${compact ? 'is-compact' : ''}`}
      role="img"
      aria-label={`Linked worktree of ${mainWorktree}`}
      title={hint}
    >
      <SquareStack aria-hidden="true" />
      {!compact && <span>Worktree</span>}
    </span>
  )
}

interface GitWorktreeSelectorProps {
  repoName?: string
  worktrees: GitWorktreeInfo[]
  activePath: string | null
  onSelectWorktree: (path: string) => void
}

/** Picks which worktree of the repository the Git view reviews; hidden when there is only one. */
export function GitWorktreeSelector({ repoName, worktrees, activePath, onSelectWorktree }: GitWorktreeSelectorProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])
  const active = getActiveWorktree(worktrees, activePath)
  if (worktrees.length < 2 || !active) return null
  const Icon = active.is_main ? FolderGit2 : SquareStack

  return (
    <div className="git-worktree-select">
      <button
        ref={triggerRef}
        type="button"
        className="git-checkout-trigger"
        onClick={() => setOpen((previous) => !previous)}
        aria-label="Select worktree"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={active.path}
      >
        <Icon aria-hidden="true" />
        <span className="git-checkout-trigger-kind">{active.is_main ? 'Checkout' : 'Worktree'}</span>
        <strong>{getWorktreeName(active)}</strong>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && <GitWorktreeMenu
        id={menuId}
        repoName={repoName}
        worktrees={worktrees}
        active={active}
        triggerRef={triggerRef}
        onClose={close}
        onSelectWorktree={onSelectWorktree}
      />}
    </div>
  )
}
