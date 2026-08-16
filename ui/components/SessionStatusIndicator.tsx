import React from 'react'
import type { SessionStatus } from '@omniterm/contract'
import { STATUS_DOT, STATUS_LABEL } from '../tabVisuals'

export interface SessionStatusIndicatorProps {
  status?: SessionStatus | null
  busy?: boolean
  isAgent?: boolean
  className?: string
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
}) => {
  if (!status) return null

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
