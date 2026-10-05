import React, { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  GitCommit,
  GitCompare,
  Minus,
  Trash2,
  Undo2,
} from 'lucide-react'

export interface GitContextMenuProps {
  x: number
  y: number
  filePath: string
  isStaged: boolean
  canStage?: boolean
  canUnstage?: boolean
  onStage?: (path: string) => void
  onUnstage?: (path: string) => void
  onDiscard?: (path: string) => void
  onDelete?: (path: string) => void
  onBlame?: (path: string) => void
  onCompareBranch?: (path: string) => void
  onClose: () => void
}

export const GitContextMenu: React.FC<GitContextMenuProps> = ({
  x,
  y,
  filePath,
  isStaged,
  canStage = true,
  canUnstage = true,
  onStage,
  onUnstage,
  onDiscard,
  onDelete,
  onBlame,
  onCompareBranch,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null)

  const posStyle: React.CSSProperties = useMemo(() => {
    const width = Math.min(256, (typeof window !== 'undefined' ? window.innerWidth : 1024) - 16)
    const height = 284
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1024
    const winH = typeof window !== 'undefined' ? window.innerHeight : 768

    const left = Math.min(x, winW - width - 8)
    const top = Math.min(y, winH - height - 8)

    return {
      position: 'fixed',
      width,
      left: `${Math.max(8, left)}px`,
      top: `${Math.max(8, top)}px`,
      zIndex: 9999,
    }
  }, [x, y])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  const content = (
    <div
      ref={menuRef}
      style={posStyle}
      role="menu"
      aria-label="Git context menu"
      className="git-menu max-h-[calc(100dvh-16px)] overflow-y-auto bg-theme-popup border border-theme-border rounded-lg shadow-2xl py-1 text-xs text-theme-fg animate-in fade-in zoom-in-95 duration-100 select-none"
    >
      <div className="px-3 py-1 font-mono text-xs text-theme-dim border-b border-theme-border/50 truncate">
        {filePath}
      </div>

      {isStaged && canUnstage && onUnstage && (
        <button
          type="button"
          onClick={() => {
            onUnstage(filePath)
            onClose()
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-theme-hover hover:text-theme-fg transition-colors text-left cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5 text-amber-400" />
          <span>Unstage</span>
        </button>
      )}

      {!isStaged && canStage && onStage && (
        <button
          type="button"
          onClick={() => {
            onStage(filePath)
            onClose()
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-theme-hover hover:text-theme-fg transition-colors text-left cursor-pointer"
        >
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>Stage</span>
        </button>
      )}

      {onDiscard && (
        <button
          type="button"
          onClick={() => {
            onDiscard(filePath)
            onClose()
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-theme-hover hover:text-rose-400 transition-colors text-left cursor-pointer"
        >
          <Undo2 className="w-3.5 h-3.5 text-rose-400" />
          <span>Discard Changes</span>
        </button>
      )}

      {onDelete && (
        <button
          type="button"
          onClick={() => {
            onDelete(filePath)
            onClose()
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-theme-hover hover:text-rose-400 transition-colors text-left cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
          <span>Delete File</span>
        </button>
      )}

      <div className="my-1 border-t border-theme-border/40" />

      {onBlame && (
        <button
          type="button"
          onClick={() => {
            onBlame(filePath)
            onClose()
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-theme-hover hover:text-theme-fg transition-colors text-left cursor-pointer"
        >
          <GitCommit className="w-3.5 h-3.5 text-theme-accent" />
          <span>Annotate (Blame)</span>
        </button>
      )}

      {onCompareBranch && (
        <button
          type="button"
          onClick={() => {
            onCompareBranch(filePath)
            onClose()
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-theme-hover hover:text-theme-fg transition-colors text-left cursor-pointer"
        >
          <GitCompare className="w-3.5 h-3.5 text-theme-dim" />
          <span>Compare with Branch...</span>
        </button>
      )}
    </div>
  )

  return typeof document !== 'undefined'
    ? createPortal(content, document.body)
    : null
}
