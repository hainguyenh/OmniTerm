import React from 'react'
import { DefaultLoadingArt } from '../assets/defaultArt'

interface ConnectingOverlayProps {
  /** Which asset to show — when dark is true, the default art adjusts its colors accordingly. */
  dark: boolean
  label?: string
  /** User-uploaded custom art URL. When set, this image is shown instead of the default. */
  customArtUrl?: string | null
}

/**
 * Shown over a pane while its session is connecting (SSH/LOCAL/RDP all reach 'connecting'
 * before 'connected'). Displays either the user's custom art or a built-in SVG animation.
 */
const ConnectingOverlay: React.FC<ConnectingOverlayProps> = ({ dark, label = 'Connecting…', customArtUrl }) => (
  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[var(--theme-bg)] select-none p-4">
    {customArtUrl ? (
      /* User-uploaded custom art */
      <img
        src={customArtUrl}
        alt=""
        className="w-[60vmin] min-w-[160px] max-w-[560px] max-h-[70%] h-auto"
      />
    ) : (
      /* License-free built-in default */
      <div className="w-[60vmin] min-w-[160px] max-w-[560px] max-h-[70%] flex items-center justify-center">
        <DefaultLoadingArt dark={dark} />
      </div>
    )}
    <span className="text-xs font-medium text-[var(--theme-fg)] opacity-60 text-center">{label}</span>
  </div>
)

export default ConnectingOverlay
