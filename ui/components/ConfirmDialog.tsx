import React, { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Small themed confirmation modal, stacked above whatever dialog opened it.
 * Escape and backdrop click both resolve to "cancel" (the safe, non-destructive
 * choice) so an accidental dismiss never discards work.
 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  confirmLabel = 'Discard',
  cancelLabel = 'Keep editing',
  onConfirm,
  onCancel,
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
      previousFocus.current?.focus()
    }
  }, [onCancel])

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel()
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60]"
      onClick={handleBackdrop}
      role="presentation"
    >
      <div
        className="bg-theme-popup w-full max-w-xs rounded-2xl border border-theme-border shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <div className="p-5 space-y-2">
          <h3 id="confirm-dialog-title" className="text-white font-bold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-theme-warning" />
            {title}
          </h3>
          <p className="text-sm text-theme-fg">{message}</p>
        </div>
        <div className="flex gap-2 p-4 pt-0">
          <button
            type="button"
            ref={cancelRef}
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl border border-theme-border text-theme-fg hover:border-theme-accent hover:text-white transition-colors text-sm font-semibold"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 py-2 rounded-xl bg-theme-error hover:bg-[#ff8da3] text-theme-accent-fg transition-colors text-sm font-bold"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
