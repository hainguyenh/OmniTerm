import type { MainLayoutModel } from './useMainLayoutController'
import WaitingPane, { type FallbackNavigatorTarget } from './WaitingPane'
import { newTerminalHoverText } from '../utils/newTerminalDescription'
import type { StoredAgentSession } from '../utils/agentSessionStorage'
import { consumeForResume } from '../utils/storedSessionResume'

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
    consumeForResume(session)
    model.requestNewSession(undefined, null, session.cwd ?? null, resumeCommand)
  }

  const fallbackTargets: FallbackNavigatorTarget[] = (model.viewGroups ?? [])
    .filter(g => g.id !== model.activeGroupId)
    .map(g => {
      const openTabCount = (model.activeTabs ?? []).filter(t => (
        g.id === 'ungrouped' ? !model.tabGroups?.[t.id] : model.tabGroups?.[t.id] === g.id
      )).length
      const label = g.label?.trim() ? g.label : (g.id === 'ungrouped' ? 'Ungrouped' : g.id)
      return { id: g.id, label, openTabCount, color: g.color }
    })
    .filter(target => target.openTabCount > 0)

  return (
    <WaitingPane
      dark={!!model.appSettings.darkMode}
      onNewSession={() => model.requestNewSession(undefined, model.selectedWorkspaceId)}
      newSessionTitle={newSessionTitle}
      onPickShell={(rect) => model.setShellMenu({ x: rect.left, y: rect.bottom + 4 })}
      customArtUrl={customArtUrl}
      onResumeSession={handleResumeSession}
      fallbackTargets={fallbackTargets}
      onNavigateTarget={model.switchViewGroup}
    />
  )
}
