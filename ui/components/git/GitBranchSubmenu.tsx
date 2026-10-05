import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowRightLeft,
  Check,
  GitCompare,
  GitMerge,
  Plus,
  Trash2,
} from 'lucide-react'
import type { GitBranchInfo } from './gitTypes'

interface GitBranchSubmenuProps {
  branch: GitBranchInfo
  currentBranch?: string
  inline?: boolean
  compact?: boolean
  onCheckout: (branch: string) => void
  onMerge: (branch: string) => void
  onRebase: (branch: string) => void
  onNewBranchFrom: (branch: string) => void
  onCompare?: (branch: string) => void
  onDelete?: (branch: string) => void
  onUpdate?: () => void
  onClose: () => void
}

export const GitBranchSubmenu: React.FC<GitBranchSubmenuProps> = ({
  branch,
  currentBranch,
  inline = false,
  compact = false,
  onCheckout,
  onMerge,
  onRebase,
  onNewBranchFrom,
  onCompare,
  onDelete,
  onUpdate,
  onClose,
}) => {
  const isCurrent = branch.is_current || branch.name === currentBranch

  return (
    <div
      role="group"
      aria-label={`Branch actions for ${branch.name}`}
      className={
        inline
          ? 'git-menu git-branch-action-list'
          : 'git-menu w-72 bg-theme-popup backdrop-blur border border-theme-border rounded-md shadow-2xl py-1 text-xs text-theme-fg z-50 select-none'
      }
      onClick={(e) => e.stopPropagation()}
    >
      {!inline && (
        <div className="px-2.5 py-1 text-[10px] text-theme-dim uppercase tracking-wider font-semibold border-b border-theme-border/50 break-words">
          {branch.name}
        </div>
      )}

      {!isCurrent && !branch.is_remote && (
        <button
          type="button"
          onClick={() => {
            onCheckout(branch.name)
            onClose()
          }}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded hover:bg-theme-hover hover:text-theme-fg text-left transition-colors cursor-pointer"
        >
          <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          <span>Checkout</span>
        </button>
      )}

      {!isCurrent && !branch.is_remote && onUpdate && <button
        type="button"
        className="git-branch-preview-action"
        onClick={() => {
          onUpdate()
          onClose()
        }}
      ><ArrowDownToLine /><span>Update without checkout…</span></button>}

      <button
        type="button"
        onClick={() => {
          onNewBranchFrom(branch.name)
          onClose()
        }}
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded hover:bg-theme-hover hover:text-theme-fg text-left transition-colors cursor-pointer"
      >
        <Plus className="w-3.5 h-3.5 text-theme-accent flex-shrink-0" />
        <span className="break-words">{compact ? 'New branch…' : `New Branch from '${branch.name}'...`}</span>
      </button>

      {!isCurrent && onCompare && (
        <button
          type="button"
          onClick={() => {
            onCompare(branch.name)
            onClose()
          }}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded hover:bg-theme-hover hover:text-theme-fg text-left transition-colors cursor-pointer"
        >
          <GitCompare className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
          <span className="break-words">{compact ? 'Compare…' : `Compare with '${currentBranch ?? 'HEAD'}'...`}</span>
        </button>
      )}

      {!isCurrent && (
        <>
          {!inline && <div className="my-1 border-t border-theme-border/50" />}

          <button
            type="button"
            onClick={() => {
              onMerge(branch.name)
              onClose()
            }}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded hover:bg-theme-hover hover:text-theme-fg text-left transition-colors cursor-pointer"
          >
            <GitMerge className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
            <span className="break-words">{compact ? 'Merge into current…' : `Merge '${branch.name}' into '${currentBranch ?? 'HEAD'}'`}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onRebase(branch.name)
              onClose()
            }}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded hover:bg-theme-hover hover:text-theme-fg text-left transition-colors cursor-pointer"
          >
            <ArrowRightLeft className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
            <span className="break-words">{compact ? 'Rebase current…' : `Rebase '${currentBranch ?? 'HEAD'}' onto '${branch.name}'`}</span>
          </button>

          {onDelete && !branch.is_remote && (
            <button
              type="button"
              onClick={() => {
                onDelete(branch.name)
                onClose()
              }}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded hover:bg-red-500/15 text-red-400 hover:text-red-300 text-left transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
              <span className="break-words">{compact ? 'Delete branch…' : `Delete '${branch.name}'...`}</span>
            </button>
          )}
        </>
      )}

      {branch.is_remote && (
        <button
          type="button"
          onClick={() => {
            onCheckout(branch.name)
            onClose()
          }}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded hover:bg-theme-hover hover:text-theme-fg text-left transition-colors cursor-pointer"
        >
          <ArrowDownLeft className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
          <span>Checkout as New Local Branch</span>
        </button>
      )}
    </div>
  )
}
