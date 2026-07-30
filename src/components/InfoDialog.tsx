import React, { useEffect } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'

interface InfoDialogProps {
  title: string
  message: string
  tone?: 'success' | 'warning'
  buttonLabel?: string
  onClose: () => void
}

/**
 * Single-button informational modal (sibling of ConfirmDialog, which is for
 * yes/no choices). Escape, backdrop click and the button all resolve to onClose.
 */
const InfoDialog: React.FC<InfoDialogProps> = ({
  title,
  message,
  tone = 'success',
  buttonLabel = 'OK',
  onClose,
}) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60]"
      onClick={handleBackdrop}
    >
      <div className="bg-theme-popup w-full max-w-xs rounded-2xl border border-theme-border shadow-2xl overflow-hidden">
        <div className="p-5 space-y-2">
          <h3 className="text-white font-bold flex items-center gap-2">
            {tone === 'warning'
              ? <AlertTriangle className="w-5 h-5 text-theme-warning" />
              : <CheckCircle2 className="w-5 h-5 text-theme-success" />}
            {title}
          </h3>
          <p className="text-sm text-theme-fg">{message}</p>
        </div>
        <div className="p-4 pt-0">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="w-full py-2 rounded-xl bg-theme-accent hover:bg-[#89ddff] text-theme-accent-fg transition-colors text-sm font-bold"
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default InfoDialog
