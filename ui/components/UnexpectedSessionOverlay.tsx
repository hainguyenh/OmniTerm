import React, { useEffect, useRef } from 'react'
import { AlertCircle, Copy, Folder, Play, Plus, X } from 'lucide-react'

import { AgentBadge } from './AgentBadge'

interface UnexpectedSessionOverlayProps {
  /** Detected agent kind (`claude`) or display name; shown as its badge, named in the tooltip. */
  agent: string
  profileName?: string
  sessionId?: string
  /** The exact command Resume will launch — shown so the user can see and copy it, never typed silently. */
  resumeCommand?: string | null
  cwd?: string
  onResume?: () => void
  onNewSession?: () => void
  onDismiss?: () => void
}

export const UnexpectedSessionOverlay: React.FC<UnexpectedSessionOverlayProps> = ({
  agent,
  profileName,
  sessionId,
  resumeCommand,
  cwd,
  onResume,
  onNewSession,
  onDismiss,
}) => {
  const resumeButtonRef = useRef<HTMLButtonElement>(null)
  const dismissButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    (resumeButtonRef.current ?? dismissButtonRef.current)?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onDismiss])

  const handleCopy = () => {
    if (resumeCommand) void navigator.clipboard.writeText(resumeCommand)
  }

  return (
    <div
      data-unexpected-session-overlay
      role="dialog"
      aria-modal="true"
      aria-labelledby="unexpected-session-title"
      className="absolute inset-0 z-20 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-3.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-sidebar-bg)] p-5 text-center shadow-2xl max-w-md w-full">
        <div className="relative">
          <div className="w-12 h-12 rounded-xl bg-[var(--theme-accent)]/15 text-[var(--theme-accent)] flex items-center justify-center border border-[var(--theme-accent)]/30">
            <AgentBadge agent={agent} profileName={profileName} className="w-6 h-6" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center">
            <AlertCircle className="w-3.5 h-3.5" />
          </div>
        </div>

        <div className="flex flex-col items-center gap-1">
          <h3 id="unexpected-session-title" className="text-sm font-bold text-[var(--theme-fg)]">
            Interrupted agent session
          </h3>
          <p className="text-xs text-[var(--theme-dim)]">
            This session was still open when OmniTerm last closed.
          </p>
        </div>

        <div className="w-full flex flex-col gap-1.5 p-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)]/60 text-left text-xs">
          {profileName && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--theme-dim)]">Profile:</span>
              <span className="font-mono font-medium text-[var(--theme-fg)]">{profileName}</span>
            </div>
          )}

          {cwd && (
            <div className="flex items-start justify-between gap-2">
              <span className="text-[var(--theme-dim)] flex items-center gap-1 mt-0.5">
                <Folder className="w-3 h-3" />
                Folder:
              </span>
              <span className="font-mono text-[11px] text-[var(--theme-fg)] truncate max-w-[240px]" title={cwd}>
                {cwd}
              </span>
            </div>
          )}

          {resumeCommand && (
            <div className="pt-1 mt-1 border-t border-[var(--theme-border)]/40 flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-[var(--theme-fg)] truncate select-text" title={resumeCommand}>
                {resumeCommand}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-[var(--theme-dim)] hover:text-[var(--theme-accent)]"
                aria-label="Copy resume command"
                title="Copy resume command"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          )}

          {sessionId && (
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--theme-border)]/40 text-[10px] text-[var(--theme-dim)]">
              <span>Session ID:</span>
              <span className="font-mono text-[var(--theme-dim)]/80 select-text">{sessionId}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 w-full pt-1">
          {onResume && (
            <button
              ref={resumeButtonRef}
              type="button"
              onClick={onResume}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--theme-accent)] text-[var(--theme-accent-fg)] text-xs font-semibold hover:opacity-90 transition-opacity shadow-sm"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Resume Session
            </button>
          )}

          {onNewSession && (
            <button
              type="button"
              onClick={onNewSession}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-sidebar-bg)] text-[var(--theme-fg)] text-xs font-medium hover:border-[var(--theme-accent)] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New Terminal
            </button>
          )}
        </div>

        {onDismiss && (
          <button
            ref={dismissButtonRef}
            type="button"
            onClick={onDismiss}
            className="text-[11px] text-[var(--theme-dim)] hover:text-[var(--theme-fg)] transition-colors inline-flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            Dismiss
          </button>
        )}
      </div>
    </div>
  )
}

export default UnexpectedSessionOverlay
