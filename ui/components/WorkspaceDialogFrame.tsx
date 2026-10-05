import { X, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface WorkspaceDialogFrameProps {
  title: string
  icon: LucideIcon
  onClose: () => void
  children: ReactNode
}

/** Modal shell for the workspace tree's small edit dialogs: backdrop and Escape both cancel. */
export function WorkspaceDialogFrame({ title, icon: Icon, onClose, children }: WorkspaceDialogFrameProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-fg)] shadow-2xl p-4 flex flex-col gap-3"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={event => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium text-sm">
            <Icon className="w-4 h-4 text-[var(--theme-accent)]" aria-hidden="true" />
            <span>{title}</span>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="p-1 rounded text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

interface WorkspaceDialogFooterProps {
  busy: boolean
  canSubmit: boolean
  submitLabel: string
  busyLabel: string
  onCancel: () => void
}

export function WorkspaceDialogFooter({ busy, canSubmit, submitLabel, busyLabel, onCancel }: WorkspaceDialogFooterProps) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="px-3 py-1 rounded text-xs text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={busy || !canSubmit}
        className="px-3 py-1 rounded text-xs font-medium bg-[var(--theme-accent)] text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? busyLabel : submitLabel}
      </button>
    </div>
  )
}

export function WorkspaceDialogError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-1 rounded">
      {message}
    </div>
  )
}
