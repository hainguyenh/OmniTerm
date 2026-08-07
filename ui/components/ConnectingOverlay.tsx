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
  <div className="absolute inset-0 z-10 overflow-auto bg-[var(--theme-bg)] select-none">
    <div className="min-h-full w-full flex flex-col items-center justify-center gap-2 p-4">
      <div
        className="relative w-[min(52%,20rem)] max-w-full max-h-full flex items-center justify-center flex-shrink-0"
        style={{ height: 'min(42%, 20rem)' }}
      >
        {customArtUrl ? (
          <img
            src={customArtUrl}
            alt={label}
            data-testid="loading-art"
            className="w-full h-full object-contain"
            style={{ transform: 'scale(2)' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center" data-testid="loading-art" style={{ transform: 'scale(2)' }}>
            <DefaultLoadingArt dark={dark} />
          </div>
        )}
      </div>
      <span className="max-w-full px-3 text-xs font-medium text-[var(--theme-fg)] opacity-60 text-center">
        {label}
      </span>
    </div>
  </div>
)

export default ConnectingOverlay
