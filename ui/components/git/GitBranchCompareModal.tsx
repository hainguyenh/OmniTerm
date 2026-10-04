import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { GitBranch, GitCompare, Loader2, Search, X } from 'lucide-react'
import { createGitAPI } from '../../gitAPI'
import type { GitBranchInfo } from './gitTypes'

interface GitBranchCompareModalProps {
  cwd: string
  filePath: string
  currentBranch?: string
  onSelectBranch: (branch: string) => void
  onClose: () => void
}

export const GitBranchCompareModal: React.FC<GitBranchCompareModalProps> = ({
  cwd,
  filePath,
  currentBranch,
  onSelectBranch,
  onClose,
}) => {
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    const api = createGitAPI()

    void api
      .getBranches(cwd)
      .then((res) => {
        if (active) {
          setBranches(res)
          setLoading(false)
        }
      })
      .catch(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [cwd])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const filteredBranches = useMemo(() => {
    const q = search.toLowerCase().trim()
    return branches.filter((b) => q === '' || b.name.toLowerCase().includes(q))
  }, [branches, search])

  const content = (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Compare with branch"
    >
      <div className="git-menu w-full max-w-md bg-theme-bg border border-theme-border rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs text-theme-fg animate-in zoom-in-95 duration-150 max-h-[70vh]">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-theme-border bg-theme-sidebar flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <GitCompare className="w-4 h-4 text-theme-accent flex-shrink-0" />
            <span className="font-semibold text-theme-fg truncate">
              Compare with Branch
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="p-1 rounded hover:bg-theme-hover hover:text-theme-fg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 py-2 border-b border-theme-border/60 bg-theme-sidebar/30">
          <div className="text-[11px] text-theme-dim mb-1.5 truncate">
            Select branch to compare <span className="font-mono text-theme-accent">{filePath}</span> against:
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-theme-bg border border-theme-border rounded">
            <Search className="w-3.5 h-3.5 text-theme-dim flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter branches..."
              className="flex-1 bg-transparent text-xs text-theme-fg placeholder-theme-dim outline-none"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1 min-h-[160px] custom-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center p-8 gap-2 text-theme-dim">
              <Loader2 className="w-4 h-4 animate-spin text-theme-accent" />
              <span>Loading branches...</span>
            </div>
          ) : filteredBranches.length === 0 ? (
            <div className="p-8 text-center text-theme-dim">No matching branches found</div>
          ) : (
            filteredBranches.map((b) => {
              const isCurrent = b.name === currentBranch || b.is_current
              return (
                <button
                  key={b.name}
                  type="button"
                  onClick={() => {
                    onSelectBranch(b.name)
                    onClose()
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left cursor-pointer transition-colors ${
                    isCurrent
                      ? 'bg-theme-accent/15 text-theme-accent font-semibold'
                      : 'hover:bg-theme-hover hover:text-theme-fg'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <GitBranch className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                    <span className="truncate">{b.name}</span>
                    {isCurrent && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-theme-accent/20 text-theme-accent">
                        current
                      </span>
                    )}
                  </div>
                  {b.is_remote && (
                    <span className="text-[10px] text-theme-dim flex-shrink-0">remote</span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined'
    ? createPortal(content, document.body)
    : null
}
