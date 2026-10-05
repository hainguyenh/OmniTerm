import { Check, FolderGit2, GitBranch, LockKeyhole, SquareStack, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, RefObject } from 'react'
import { createPortal } from 'react-dom'

import type { GitWorktreeInfo } from './gitTypes'
import { getWorktreeHead, getWorktreeName } from './gitWorktreePresentation'

interface GitWorktreeMenuProps {
  id: string
  repoName?: string
  worktrees: GitWorktreeInfo[]
  active: GitWorktreeInfo
  triggerRef: RefObject<HTMLButtonElement>
  onClose: (restoreFocus?: boolean) => void
  onSelectWorktree: (path: string) => void
}

export function GitWorktreeMenu({ id, repoName, worktrees, active, triggerRef, onClose, onSelectWorktree }: GitWorktreeMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const main = worktrees.filter((worktree) => worktree.is_main)
  const linked = worktrees.filter((worktree) => !worktree.is_main)

  useLayoutEffect(() => {
    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect()
      if (!anchor) return
      const width = Math.min(440, window.innerWidth - 16)
      const below = Math.max(0, window.innerHeight - anchor.bottom - 16)
      const above = Math.max(0, anchor.top - 16)
      const upward = below < 280 && above > below
      setStyle({
        position: 'fixed',
        width,
        left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
        top: upward ? undefined : anchor.bottom + 8,
        bottom: upward ? window.innerHeight - anchor.top + 8 : undefined,
        maxHeight: upward ? above : below,
      })
    }
    place()
    const dismiss = (event: MouseEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) {
        onClose(false)
      }
    }
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    document.addEventListener('mousedown', dismiss)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
      document.removeEventListener('mousedown', dismiss)
    }
  }, [onClose, triggerRef])

  useLayoutEffect(() => {
    if (style.visibility === 'hidden') return
    menuRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]:not(:disabled)')?.focus()
  }, [style.visibility])

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.target instanceof HTMLButtonElement && event.target.hasAttribute('data-checkout')
      && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const choices = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button[data-checkout]:not(:disabled)') ?? [])
      const index = choices.indexOf(event.target)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length
      choices[next]?.focus()
      event.preventDefault()
    }
  }

  const renderCheckout = (worktree: GitWorktreeInfo) => {
    const selected = worktree.path === active.path
    const Icon = worktree.is_main ? FolderGit2 : SquareStack
    return (
      <button
        key={worktree.path}
        type="button"
        className="git-checkout-option"
        data-checkout
        aria-label={`${getWorktreeName(worktree)} · ${getWorktreeHead(worktree)}`}
        aria-pressed={selected}
        disabled={worktree.is_prunable}
        title={worktree.path}
        onClick={() => {
          onSelectWorktree(worktree.path)
          onClose()
        }}
      >
        <Icon aria-hidden="true" />
        <span className="git-checkout-details">
          <span className="git-checkout-name">
            <strong>{getWorktreeName(worktree)}</strong>
            {worktree.is_main && <span className="git-checkout-tag">Repo folder</span>}
            {worktree.is_locked && <span className="git-checkout-tag"><LockKeyhole aria-hidden="true" />Locked</span>}
          </span>
          <span className="git-checkout-head"><GitBranch aria-hidden="true" />{getWorktreeHead(worktree)}</span>
          <span className="git-checkout-path">{worktree.path}</span>
          {worktree.is_prunable && <span className="git-checkout-missing">Folder missing</span>}
        </span>
        {selected && <Check className="git-checkout-selected" aria-hidden="true" />}
      </button>
    )
  }

  return createPortal(
    <div
      id={id}
      ref={menuRef}
      style={style}
      className="git-checkout-menu"
      role="dialog"
      aria-label={repoName ? `Checkouts of ${repoName}` : 'Repository checkouts'}
      onKeyDown={navigate}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)
          && !triggerRef.current?.contains(event.relatedTarget)) onClose(false)
      }}
    >
      <div className="git-checkout-menu-header">
        <strong>{repoName ? `Checkouts of ${repoName}` : 'Repository checkouts'}</strong>
        <button type="button" className="git-icon-button" aria-label="Close checkout picker" onClick={() => onClose()}><X /></button>
      </div>
      <div className="git-checkout-options">
        {main.map(renderCheckout)}
        {linked.length > 0 && (
          <>
            <div className="git-checkout-group-heading"><span>Linked worktrees</span><span>{linked.length}</span></div>
            <div className="git-checkout-linked">{linked.map(renderCheckout)}</div>
          </>
        )}
      </div>
      <p className="git-checkout-menu-footer">Select a checkout to view its local changes.</p>
    </div>,
    document.body,
  )
}
