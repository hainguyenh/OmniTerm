import { useMemo } from 'react'

import { useAllPanePresence } from '../../utils/agentPresenceStore'
import { scopedWorkspaceId, useWorkspaceStore } from '../../platform/workspaceStore'
import { buildSessionsTree, type SessionSection } from '../../utils/sessionsTree'
import type { SessionsPanelProps } from '../../components/SessionsPanel'
import { useShellPanels } from '../shellPanelsStore'

/** Live agent sessions the Sessions panel lists, so the badge never counts a pane the panel hides. */
export function countLiveAgents(sections: readonly SessionSection[]): number {
  let count = 0
  for (const section of sections) {
    for (const group of section.groups) count += group.sessions.filter((node) => !node.stored).length
  }
  return count
}

/** The Sessions stripe badge: the running AI agents of the scoped workspace, null for none. */
export function useSessionsBadge(): number | null {
  const props: SessionsPanelProps | null = useShellPanels((state) => state.sessions)
  const presence = useAllPanePresence()
  const scopeWorkspaceId = useWorkspaceStore(scopedWorkspaceId)
  const count = useMemo(() => {
    if (!props) return 0
    return countLiveAgents(buildSessionsTree({
      tabs: props.tabs,
      workspaces: props.workspaces,
      connById: props.connById,
      isEditor: props.isEditor,
      filter: 'agents',
      scopeWorkspaceId,
      cwdOf: (id) => presence[id]?.launchCwd ?? props.sessionCwds[id],
      agentOf: (id) => presence[id]?.agent,
    }))
  }, [props, presence, scopeWorkspaceId])
  return count > 0 ? count : null
}
