import React, { useEffect, useState } from 'react'
import { RotateCw } from 'lucide-react'

interface RenewSessionModalProps {
  sessionName?: string
  strategy?: 'reopen' | 'new-command'
  onConfirm: (remember: boolean) => void
  onCancel: () => void
}

export const RenewSessionModal: React.FC<RenewSessionModalProps> = ({
  sessionName,
  strategy = 'reopen',
  onConfirm,
  onCancel,
}) => {
  const [remember, setRemember] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCancel])

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel()
  }

  const description = strategy === 'new-command'
    ? 'Start a fresh conversation in the active AI agent (/clear for Claude Code, /new for others)?'
    : 'Terminate the current session process tree and restart the AI agent profile in the current directory?'

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70]"
      onClick={handleBackdrop}
      data-testid="renew-session-modal"
    >
      <div className="bg-theme-popup w-full max-w-sm rounded-2xl border border-theme-border shadow-2xl overflow-hidden">
        <div className="p-5 space-y-3">
          <h3 className="text-[var(--theme-selection-fg)] font-bold flex items-center gap-2 text-lg">
            <RotateCw className="w-5 h-5 text-theme-accent" />
            Renew Session
          </h3>
          {sessionName && (
            <div className="text-xs font-medium text-theme-dim truncate">
              {sessionName}
            </div>
          )}
          <p className="text-sm text-theme-fg leading-relaxed">
            {description}
          </p>

          <label className="flex items-start gap-2 cursor-pointer mt-3 text-sm text-theme-fg group">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              data-testid="renew-session-remember-checkbox"
              className="mt-0.5 w-4 h-4 rounded border-theme-border bg-theme-bg accent-theme-accent focus:ring-0 focus:ring-offset-0 cursor-pointer"
            />
            <div className="flex flex-col">
              <span className="group-hover:text-[var(--theme-selection-fg)] transition-colors">
                Remember choice (don&apos;t ask again)
              </span>
              <span className="text-[11px] text-theme-dim">
                Applies to the current app session only
              </span>
            </div>
          </label>
        </div>

        <div className="flex gap-2 p-4 pt-0">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            data-testid="renew-session-cancel-button"
            className="flex-1 py-2 rounded-xl border border-theme-border text-theme-fg hover:border-theme-accent hover:text-[var(--theme-selection-fg)] transition-colors text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(remember)}
            data-testid="renew-session-confirm-button"
            className="flex-1 py-2 rounded-xl bg-theme-accent hover:brightness-110 text-theme-accent-fg transition-colors text-sm font-bold"
          >
            Renew
          </button>
        </div>
      </div>
    </div>
  )
}

export default RenewSessionModal
