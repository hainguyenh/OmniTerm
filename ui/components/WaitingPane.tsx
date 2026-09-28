import React from 'react'
import { Plus, Terminal, ChevronDown, LayoutGrid } from 'lucide-react'
import { DefaultIdleArt } from '../assets/defaultArt'
import { Tooltip } from './Tooltip'
import DashboardPreviousSessions from './DashboardPreviousSessions'
import type { StoredAgentSession } from '../utils/agentSessionStorage'

/**
 * The "nothing here yet" page / Dashboard view. Used both for the whole content area (no tabs at all)
 * and inside every empty split pane. Displays previous AI agent sessions when available for quick
 * resumption, alongside new terminal creation.
 */
interface WaitingPaneProps {
  dark: boolean
  /** Rendered inside a split pane: smaller art, no keyboard hint. */
  compact?: boolean
  onNewSession: () => void
  /** Hover text describing the exact shell and directory the primary action will launch. */
  newSessionTitle?: string
  onPickShell: (rect: DOMRect) => void
  /** Omitted in single view, where there is no other pane to adopt a session from. */
  onChooseSession?: (rect: DOMRect) => void
  /** Sessions currently open — shown on the adopt button so an empty strip is obvious. */
  openSessionCount?: number
  /** Set inside a split pane: names the pane in its own shape + hue (see paneIdentity.ts). */
  paneIndex?: number
  /** User-uploaded custom art URL. When set, this image is shown instead of the default. */
  customArtUrl?: string | null
  /** Resume a stored or interrupted AI agent session, with its already-validated resume command. */
  onResumeSession?: (session: StoredAgentSession, resumeCommand: string) => void
}

const WaitingPane: React.FC<WaitingPaneProps> = ({
  dark,
  compact = false,
  onNewSession,
  newSessionTitle,
  onPickShell,
  onChooseSession,
  openSessionCount = 0,
  customArtUrl,
  onResumeSession,
}) => (
  <div className="h-full w-full overflow-auto text-[var(--theme-dim)] select-none">
    <div className={`min-h-full w-full flex flex-col items-center justify-center ${
      compact ? 'p-3' : 'p-4'
    }`}>
      <div className={`w-full max-w-[36rem] flex flex-col items-center ${
        compact ? 'gap-2' : 'gap-4'
      }`}>
        {/* Previous sessions dashboard cards (when available) */}
        {!compact && onResumeSession && (
          <DashboardPreviousSessions onResume={onResumeSession} />
        )}

        {/* Art follows both pane dimensions so narrow and shallow split panes stay usable. */}
        <div
          className="relative flex-shrink-0 max-w-full max-h-full flex items-center justify-center pointer-events-none"
          style={{
            width: compact ? 'min(44%, 8rem)' : 'min(50%, 14rem)',
            height: compact ? 'min(34%, 8rem)' : 'min(38%, 14rem)',
          }}
        >
          {customArtUrl ? (
            <img src={customArtUrl} alt="waiting"
              data-testid="idle-art"
              className="relative w-[85%] h-auto max-h-full opacity-90 object-contain"
              style={{ transform: 'scale(2)' }} />
          ) : (
            <>
              <Terminal className="absolute inset-0 h-full w-full opacity-[0.04]" strokeWidth={1.25} />
              <div className="relative w-[75%] h-[75%]" data-testid="idle-art">
                <DefaultIdleArt dark={dark} />
              </div>
            </>
          )}
        </div>

        <div className="text-center px-3 max-w-full flex-shrink-0">
          {!compact && (
            <p className="font-semibold text-[var(--theme-fg)] opacity-50 text-sm">
              Open a terminal
            </p>
          )}
          {!compact && (
            <p className="text-xs mt-1.5 opacity-30">
              Press <kbd className="px-1.5 py-0.5 rounded border border-[var(--theme-border)] text-[10px] font-mono bg-[var(--theme-popup-bg)] mx-0.5">Ctrl+N</kbd> to open a new terminal tab.
            </p>
          )}
        </div>

        <div className="flex flex-col items-center justify-center gap-3 max-w-full flex-shrink-0">
          <div className="flex items-center justify-center flex-wrap gap-2.5 w-full">
            <div className="flex items-center gap-1">
              <div className="flex rounded-lg bg-[var(--theme-accent)] hover:opacity-90 transition-opacity">
                <Tooltip content={newSessionTitle ?? 'New Terminal'} shortcut="Ctrl+N" placement="top">
                  <button
                    type="button"
                    onClick={onNewSession}
                    className={`inline-flex items-center justify-center gap-1.5 text-[var(--theme-accent-fg)] font-bold rounded-l-lg ${
                      compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-xs'
                    }`}
                    aria-label="New Terminal"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Terminal
                  </button>
                </Tooltip>
                <button
                  type="button"
                  onClick={(e) => onPickShell(e.currentTarget.getBoundingClientRect())}
                  className="inline-flex items-center justify-center px-2 text-[var(--theme-accent-fg)] border-l border-[var(--theme-accent-fg)]/30 rounded-r-lg" aria-label="Select Shell"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {onChooseSession && (
              <button
                type="button"
                onClick={(e) => onChooseSession(e.currentTarget.getBoundingClientRect())}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-theme-border text-theme-dim text-xs hover:text-theme-accent hover:border-theme-accent transition-colors"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Choose open session{openSessionCount > 0 ? ` (${openSessionCount})` : ''}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  </div>
)

export default WaitingPane
