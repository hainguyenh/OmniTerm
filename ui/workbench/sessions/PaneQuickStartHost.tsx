import { SessionsQuickStart } from '../../components/SessionsQuickStart'
import { scopedWorkspaceId, selectedWorkspaceId, useWorkspaceStore } from '../../platform/workspaceStore'
import { useShellPanels } from '../shellPanelsStore'

import { closePaneQuickStart, focusPickerPane, usePaneQuickStart } from './paneQuickStartStore'

/** The session picker an empty pane opened: the Sessions quick start, starting into that pane. */
export function PaneQuickStartHost() {
  const target = usePaneQuickStart((s) => s.target)
  const sessions = useShellPanels((s) => s.sessions)
  const scopeWorkspaceId = useWorkspaceStore(scopedWorkspaceId)
  const currentWorkspaceId = useWorkspaceStore((state) => selectedWorkspaceId(state.selection))
  if (!target || !sessions) return null
  return (
    <SessionsQuickStart
      // A new anchor remounts the picker: it measures its position once.
      key={`${target.paneId}:${target.at.x}:${target.at.y}`}
      workspaces={sessions.workspaces}
      workspaceId={scopeWorkspaceId ?? currentWorkspaceId}
      at={target.at}
      onStart={(project, command) => {
        focusPickerPane(target.paneId)
        sessions.onStart(project, command)
      }}
      onClose={closePaneQuickStart}
    />
  )
}
