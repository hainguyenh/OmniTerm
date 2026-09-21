import type { MainLayoutModel } from './useMainLayoutController'
import WaitingPane from './WaitingPane'
import { newTerminalHoverText } from '../utils/newTerminalDescription'

interface MainLayoutWaitingPaneProps {
  model: MainLayoutModel
  customArtUrl?: string | null
}

export default function MainLayoutWaitingPane({ model, customArtUrl }: MainLayoutWaitingPaneProps) {
  const newSessionTitle = newTerminalHoverText(
    model.shellOptions ?? [], model.appSettings.defaultShell, model.workspaces ?? [],
    model.selectedWorkspaceId ?? null, model.homeDir ?? '',
  )
  return (
    <WaitingPane
      dark={!!model.appSettings.darkMode}
      onNewSession={() => model.requestNewSession(undefined, model.selectedWorkspaceId)}
      newSessionTitle={newSessionTitle}
      onPickShell={(rect) => model.setShellMenu({ x: rect.left, y: rect.bottom + 4 })}
      customArtUrl={customArtUrl}
    />
  )
}
