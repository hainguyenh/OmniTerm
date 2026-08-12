import React from 'react'
import { Plus, Terminal, ChevronDown, LayoutGrid } from 'lucide-react'
import { DefaultIdleArt } from '../assets/defaultArt'
import WorkspaceSelect from './WorkspaceSelect'
import type { Workspace } from '@omniterm/contract'

/**
 * The "nothing here yet" page. Used both for the whole content area (no tabs at all) and inside every
 * empty split pane, so an idle pane looks like the app's waiting state instead of a pair of bare
 * buttons. Both actions the pane used to offer are kept: start a new terminal (with the shell picker
 * on the chevron) and adopt an already-open session.
 */
interface WaitingPaneProps {
  dark: boolean
  /** Rendered inside a split pane: smaller art, no keyboard hint. */
  compact?: boolean
  onNewSession: () => void
  workspaces?: Workspace[]
  selectedWorkspaceId?: string | null
  onWorkspaceChange?: (id: string | null) => void
  onPickShell: (rect: DOMRect) => void
  /** Omitted in single view, where there is no other pane to adopt a session from. */
  onChooseSession?: (rect: DOMRect) => void
  /** Sessions currently open — shown on the adopt button so an empty strip is obvious. */
  openSessionCount?: number
  /** Set inside a split pane: names the pane in its own shape + hue (see paneIdentity.ts). */
  paneIndex?: number
  /** User-uploaded custom art URL. When set, this image is shown instead of the default. */
  customArtUrl?: string | null
}

const WaitingPane: React.FC<WaitingPaneProps> = ({
  dark, compact = false, onNewSession, onPickShell, onChooseSession, workspaces = [], selectedWorkspaceId = null, onWorkspaceChange = () => {}, openSessionCount = 0, customArtUrl,
}) => (
  <div className="h-full w-full overflow-auto text-[var(--theme-dim)] select-none">
    <div className={`min-h-full w-full flex flex-col items-center justify-center ${
      compact ? 'p-3' : 'p-4'
    }`}>
      <div className={`w-full max-w-[32rem] flex flex-col items-center ${
        compact ? 'gap-2' : 'gap-5'
      }`}>
        {/* Art follows both pane dimensions so narrow and shallow split panes stay usable. */}
        <div
          className="relative flex-shrink-0 max-w-full max-h-full flex items-center justify-center pointer-events-none"
          style={{
            width: compact ? 'min(44%, 10rem)' : 'min(62%, 22rem)',
            height: compact ? 'min(34%, 10rem)' : 'min(48%, 22rem)',
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
              <div className="relative w-[75%] h-[75%]" data-testid="idle-art" style={{ transform: 'scale(2)' }}>
                <DefaultIdleArt dark={dark} />
              </div>
            </>
          )}
        </div>

        <div className="text-center px-3 max-w-full flex-shrink-0">
          <div className="flex flex-col items-center gap-1 mb-2">
            <WorkspaceSelect workspaces={workspaces} value={selectedWorkspaceId} onChange={onWorkspaceChange} compact />
          </div>
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

        <div className="flex items-center justify-center flex-wrap gap-2.5 max-w-full flex-shrink-0">
          <div className="flex items-center gap-1">
            <div className="flex rounded-lg bg-[var(--theme-accent)] hover:opacity-90 transition-opacity">
            <button
              type="button"
              onClick={onNewSession}
              className={`inline-flex items-center justify-center gap-1.5 text-[var(--theme-accent-fg)] font-bold rounded-l-lg ${
                compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-xs'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              New Terminal
            </button>
            <button
              type="button"
              onClick={(e) => onPickShell(e.currentTarget.getBoundingClientRect())}
              className="inline-flex items-center justify-center px-2 text-[var(--theme-accent-fg)] border-l border-[var(--theme-accent-fg)]/30 rounded-r-lg"
              title="Select Shell"
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
)

export default WaitingPane
