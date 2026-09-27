import React, { useState } from 'react'
import { formatAgentResumeCommand } from '../utils/agentRegistry'
import { findInterruptedSessionByTabId, removeStoredSession, useStoredSessions } from '../utils/agentSessionStorage'
import { UnexpectedSessionOverlay } from './UnexpectedSessionOverlay'

interface PaneSessionOverlayHostProps {
  /** The pane's tab id — an interrupted session shows only on the exact tab it belonged to. */
  sessionId: string
  onNewSession?: () => void
  /** Open a fresh pane running the resume command, instead of typing it into whatever is here now. */
  onResumeCommand?: (command: string, cwd?: string) => void
}

export const PaneSessionOverlayHost: React.FC<PaneSessionOverlayHostProps> = ({
  sessionId,
  onNewSession,
  onResumeCommand,
}) => {
  useStoredSessions() // re-render when storage changes; the lookup itself reads the live list
  const [dismissed, setDismissed] = useState(false)
  const session = findInterruptedSessionByTabId(sessionId)

  if (!session || dismissed) {
    return null
  }

  const resumeCommand = formatAgentResumeCommand('Claude Code', session.sessionId, session.launcher)

  const handleResume = () => {
    if (!resumeCommand) return
    removeStoredSession(session.id)
    setDismissed(true)
    onResumeCommand?.(resumeCommand, session.cwd)
  }

  const handleNewSession = () => {
    removeStoredSession(session.id)
    setDismissed(true)
    onNewSession?.()
  }

  const handleDismiss = () => {
    setDismissed(true)
  }

  return (
    <UnexpectedSessionOverlay
      agentName="Claude Code"
      profileName={session.profileName}
      sessionId={session.sessionId}
      resumeCommand={resumeCommand}
      cwd={session.cwd}
      onResume={resumeCommand ? handleResume : undefined}
      onNewSession={handleNewSession}
      onDismiss={handleDismiss}
    />
  )
}
