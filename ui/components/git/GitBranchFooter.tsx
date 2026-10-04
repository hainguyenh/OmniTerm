import React, { useEffect, useState } from 'react'
import { ChevronDown, GitBranch } from 'lucide-react'
import { createGitAPI } from '../../gitAPI'
import type { GitRepoStatus } from './gitTypes'
import { GitBranchPopup } from './GitBranchPopup'
import { Tooltip } from '../Tooltip'

interface GitBranchFooterProps {
  status?: GitRepoStatus | null
  cwd?: string
  onClick?: () => void
}

export const GitBranchFooter: React.FC<GitBranchFooterProps> = ({
  status: initialStatus,
  cwd,
  onClick,
}) => {
  const [status, setStatus] = useState<GitRepoStatus | null>(initialStatus ?? null)
  const [popupOpen, setPopupOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (initialStatus !== undefined) {
      setStatus(initialStatus)
    }
  }, [initialStatus])

  useEffect(() => {
    if (!cwd) {
      if (initialStatus === undefined) setStatus(null)
      return
    }

    let active = true
    const api = createGitAPI()

    const loadStatus = () => {
      void api
        .getStatus(cwd)
        .then((res) => {
          if (active) setStatus(res)
        })
        .catch(() => {
          if (active) setStatus(null)
        })
    }

    loadStatus()
    window.addEventListener('omniterm:git-refresh', loadStatus)
    return () => {
      active = false
      window.removeEventListener('omniterm:git-refresh', loadStatus)
    }
  }, [cwd, initialStatus])

  if (!status) return null

  const branchName = status.branch || (status.is_detached ? 'detached' : 'HEAD')
  const hasAhead = status.ahead > 0
  const hasBehind = status.behind > 0
  const effectiveCwd = status.repo_root || cwd

  const aheadBehindStr = [
    hasAhead ? `↑${status.ahead}` : null,
    hasBehind ? `↓${status.behind}` : null,
  ].filter(Boolean).join(' ')

  const handleBranchClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (onClick) {
      onClick()
    } else {
      setAnchorRect(e.currentTarget.getBoundingClientRect())
      setPopupOpen((prev) => !prev)
    }
  }

  return (
    <div className="relative flex items-center gap-1.5 flex-shrink-0 text-[10px]">
      <Tooltip content={`Git branch: ${branchName}${aheadBehindStr ? ` (${aheadBehindStr})` : ''}`} placement="top">
        <button
          type="button"
          onClick={handleBranchClick}
          onContextMenu={(e) => {
            e.preventDefault()
            handleBranchClick(e)
          }}
          aria-label={`Current branch: ${branchName}`}
          className="inline-flex items-center gap-1.5 min-h-6 px-2 py-1 rounded text-theme-dim hover:text-theme-fg hover:bg-theme-bg/60 transition-colors font-mono cursor-pointer"
        >
          <GitBranch className="w-4 h-4 text-theme-accent" />
          <span className="font-semibold text-theme-fg">{branchName}</span>
          <ChevronDown className="w-3.5 h-3.5" />
          {aheadBehindStr && (
            <span className="text-theme-accent font-medium">{aheadBehindStr}</span>
          )}
        </button>
      </Tooltip>

      {popupOpen && effectiveCwd && (
        <GitBranchPopup
          cwd={effectiveCwd}
          currentBranch={branchName}
          anchorRect={anchorRect}
          onClose={() => setPopupOpen(false)}
          onOpenCommit={() => window.dispatchEvent(new CustomEvent('omniterm:open-git'))}
          onBranchSwitched={() => {
            window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
          }}
        />
      )}
    </div>
  )
}
