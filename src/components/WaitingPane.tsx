import React from 'react'
import { Plus, Terminal, ChevronDown, LayoutGrid } from 'lucide-react'
import { DefaultIdleArt } from '../assets/defaultArt'
import { paneIdentity } from '../paneIdentity'

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
  onPickShell: (rect: DOMRect) => void
  /** Omitted in single view, where there is no other pane to adopt a session from. */
  onChooseSession?: () => void
  /** Sessions currently open — shown on the adopt button so an empty strip is obvious. */
  openSessionCount?: number
  /** Set inside a split pane: names the pane in its own shape + hue (see paneIdentity.ts). */
  paneIndex?: number
  /** User-uploaded custom art URL. When set, this image is shown instead of the default. */
  customArtUrl?: string | null
}

const WaitingPane: React.FC<WaitingPaneProps> = ({
  dark, compact = false, onNewSession, onPickShell, onChooseSession, openSessionCount = 0, paneIndex, customArtUrl,
}) => (
  <div className={`h-full w-full flex flex-col items-center justify-center overflow-y-auto min-h-0 text-[var(--theme-dim)] select-none ${
    compact ? 'gap-3 py-3' : 'gap-5 py-4'
  }`}>
    {/* Art area: user-uploaded custom art, or the built-in default SVG. The box is square so the
        art fills it proportionally. */}
    <div className={`relative aspect-square flex items-center justify-center flex-shrink ${
      compact ? 'w-[26vmin] min-w-[60px] max-w-[220px]' : 'w-[40vmin] min-w-[100px] max-w-[360px]'
    }`}>
      {customArtUrl ? (
        /* User-uploaded custom art */
        <img src={customArtUrl} alt="waiting"
          className="relative w-[85%] h-auto opacity-90 object-contain" />
      ) : (
        /* License-free built-in default: a terminal watermark icon with a subtle prompt animation */
        <>
          <Terminal className="absolute inset-0 h-full w-full opacity-[0.04]" strokeWidth={1.25} />
          <div className="relative w-[75%] h-[75%]">
            <DefaultIdleArt dark={dark} />
          </div>
        </>
      )}
    </div>

    <div className="text-center px-3 flex-shrink-0">
      {paneIndex !== undefined && (() => {
        const identity = paneIdentity(paneIndex)
        const Shape = identity.icon
        return (
          <p className="flex items-center justify-center gap-1 mb-1 text-[10px] font-bold uppercase tracking-wider"
            style={{ color: identity.color }} title={identity.label}>
            <Shape className="w-3 h-3" fill={identity.color} />
            Pane {paneIndex + 1}
          </p>
        )
      })()}
      <p className={`font-semibold text-[var(--theme-fg)] opacity-50 ${compact ? 'text-xs' : 'text-sm'}`}>
        Open a terminal
      </p>
      {!compact && (
        <p className="text-xs mt-1.5 opacity-30">
          Press <kbd className="px-1.5 py-0.5 rounded border border-[var(--theme-border)] text-[10px] font-mono bg-[var(--theme-popup-bg)] mx-0.5">Ctrl+N</kbd> to open a new terminal tab.
        </p>
      )}
    </div>

    <div className={`flex items-center flex-shrink-0 ${compact ? 'flex-col gap-2' : 'gap-2.5'}`}>
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
      {onChooseSession && (
        <button
          type="button"
          onClick={onChooseSession}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-theme-border text-theme-dim text-xs hover:text-theme-accent hover:border-theme-accent transition-colors"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          Choose open session{openSessionCount > 0 ? ` (${openSessionCount})` : ''}
        </button>
      )}
    </div>
  </div>
)

export default WaitingPane
