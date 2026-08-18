import React from 'react'
import type { SessionStatus } from '@omniterm/contract'
import { STATUS_DOT, STATUS_LABEL } from '../tabVisuals'

export interface SessionStatusIndicatorProps {
  status?: SessionStatus | null
  busy?: boolean
  isAgent?: boolean
  className?: string
  /** Visualization of the busy state: `oscillate` sways the dot left-right with a 2-step ghost
   *  trail (used in the pane header, where there is room for a wider animation); `ping` (default)
   *  keeps the expanding ring used by smaller slots like the tab strip and pane picker. */
  runningStyle?: 'ping' | 'oscillate'
}

/**
 * Renders session status indicator:
 * - Special glowing sonar ping wave for AI agents or active commands
 * - Pulsing warning beacon while connecting
 * - Hollow ring for connected idle local shells
 * - Muted dot for disconnected or errored sessions
 */
export const SessionStatusIndicator: React.FC<SessionStatusIndicatorProps> = ({
  status = 'connecting',
  busy,
  isAgent,
  className = '',
  runningStyle = 'ping',
}) => {
  if (!status) return null

  // Oscillating dot with a 2-step ghost trail — used in the pane header, which has room for a wider
  // animation. Bay 40×8 (`w-10 h-2`); dot 6×6 (`h-1.5 w-1.5`); travel ±15px = 5× dot width
  // peak-to-peak. Ghosts lag the dot by 150ms / 300ms via positive animation-delay.
  if (status === 'connected' && busy && runningStyle === 'oscillate') {
    return (
      <span
        className={`relative w-10 h-2 flex-shrink-0 ${className}`}
        title={isAgent ? 'AI agent running' : 'Running process'}
        role="status"
      >
        <span className="absolute top-[1px] left-[17px] h-1.5 w-1.5 rounded-full bg-theme-accent running-dot-ghost-2" />
        <span className="absolute top-[1px] left-[17px] h-1.5 w-1.5 rounded-full bg-theme-accent running-dot-ghost-1" />
        <span className="absolute top-[1px] left-[17px] h-1.5 w-1.5 rounded-full bg-theme-accent animate-running-dot-oscillate shadow-[0_0_6px_var(--theme-accent)]" />
      </span>
    )
  }

  // Special animated running effect for running terminal command or active agent turn
  if (status === 'connected' && busy) {
    return (
      <span
        className={`relative flex h-2 w-2 items-center justify-center flex-shrink-0 ${className}`}
        title={isAgent ? 'AI agent running' : 'Running command'}
      >
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-theme-accent opacity-75 duration-1000" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-theme-accent shadow-[0_0_6px_var(--theme-accent)]" />
      </span>
    )
  }

  // Connecting pulse state
  if (status === 'connecting') {
    return (
      <span
        className={`relative flex h-2 w-2 items-center justify-center flex-shrink-0 ${className}`}
        title="Connecting…"
      >
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-theme-warning opacity-60 duration-1000" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-theme-warning" />
      </span>
    )
  }

  // Connected but idle
  if (status === 'connected' && busy === false) {
    return (
      <span
        className={`w-1.5 h-1.5 rounded-full border border-theme-dim bg-transparent flex-shrink-0 ${className}`}
        title="Idle"
      />
    )
  }

  // Connected (general/SSH/RDP without activity polling)
  if (status === 'connected') {
    return (
      <span
        className={`w-1.5 h-1.5 rounded-full bg-theme-accent flex-shrink-0 ${className}`}
        title="Connected"
      />
    )
  }

  // Disconnected / Error
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[status]} ${className}`}
      title={STATUS_LABEL[status]}
    />
  )
}

export default SessionStatusIndicator
