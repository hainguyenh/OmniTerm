import React from 'react'
import { loadingCatLight, loadingCatDark } from '../assets/loadingCat'

interface ConnectingOverlayProps {
  /** Which asset to show — the light-mode art is a dark cat; dark mode uses a
   *  color-inverted (pale) variant so it stays visible against a dark pane. */
  dark: boolean
  label?: string
}

/**
 * Shown over a pane while its session is connecting (SSH/LOCAL/RDP all reach 'connecting'
 * before 'connected'). Both variants have their background removed (alpha-decontaminated,
 * not a hard color-key) so they read cleanly against the pane behind them.
 */
const ConnectingOverlay: React.FC<ConnectingOverlayProps> = ({ dark, label = 'Connecting…' }) => (
  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[var(--theme-bg)] select-none p-4">
    {/* vmin-based sizing (matching WaitingPane's boring-cat art) so this scales with the pane instead
        of the viewport: a fixed px width overflowed a narrow split pane long before the old
        `max-w-[85%]` ever kicked in, and left the art oddly large/small at other window sizes. */}
    <img
      src={dark ? loadingCatDark : loadingCatLight}
      alt=""
      className="w-[60vmin] min-w-[160px] max-w-[560px] max-h-[70%] h-auto"
    />
    <span className="text-xs font-medium text-[var(--theme-fg)] opacity-60 text-center">{label}</span>
  </div>
)

export default ConnectingOverlay
