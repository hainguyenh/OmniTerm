import type { MainLayoutModel } from './useMainLayoutController'
import WaitingPane from './WaitingPane'
import { newTerminalHoverText } from '../utils/newTerminalDescription'
import { removeStoredSession, type StoredAgentSession } from '../utils/agentSessionStorage'

interface MainLayoutWaitingPaneProps {
  model: MainLayoutModel
  customArtUrl?: string | null
}

export default function MainLayoutWaitingPane({ model, customArtUrl }: MainLayoutWaitingPaneProps) {
  const newSessionTitle = newTerminalHoverText(
    model.shellOptions ?? [], model.appSettings.defaultShell, model.workspaces ?? [],
    model.selectedWorkspaceId ?? null, model.homeDir ?? '',
  )

  const handleResumeSession = (session: StoredAgentSession, resumeCommand: string) => {
    removeStoredSession(session.id)
    model.requestNewSession(undefined, null, session.cwd ?? null, resumeCommand)
  }

  return (
    <WaitingPane
      dark={!!model.appSettings.darkMode}
      onNewSession={() => model.requestNewSession(undefined, model.selectedWorkspaceId)}
      newSessionTitle={newSessionTitle}
      onPickShell={(rect) => model.setShellMenu({ x: rect.left, y: rect.bottom + 4 })}
      customArtUrl={customArtUrl}
      onResumeSession={handleResumeSession}
    />
  )
}
