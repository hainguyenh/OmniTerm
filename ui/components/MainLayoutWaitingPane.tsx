import type { MainLayoutModel } from './useMainLayoutController'
import WaitingPane from './WaitingPane'

interface MainLayoutWaitingPaneProps {
  model: MainLayoutModel
  customArtUrl?: string | null
}

export default function MainLayoutWaitingPane({ model, customArtUrl }: MainLayoutWaitingPaneProps) {
  return (
    <WaitingPane
      dark={!!model.appSettings.darkMode}
      onNewSession={() => model.requestNewSession(undefined, model.selectedWorkspaceId)}
      onPickShell={(rect) => model.setShellMenu({ x: rect.left, y: rect.bottom + 4 })}
      customArtUrl={customArtUrl}
    />
  )
}
