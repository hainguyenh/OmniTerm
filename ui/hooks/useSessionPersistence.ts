/**
 * useSessionPersistence.ts — reads the startup snapshot once and writes a live snapshot back on
 * every meaningful layout change (debounced to avoid hammering localStorage on rapid edits).
 *
 * An empty layout writes nothing: `useSessionRestore` consumes the stored snapshot once it has
 * been applied, so a crashed or force-quit app still restores on the next open, while a layout
 * the user deliberately emptied stays empty.
 */
import { useEffect, useRef } from 'react'
import type { Connection } from '@omniterm/contract'
import type { LayoutMode } from '../themes'
import type { ViewGroup } from '../viewGroups'
import { parseAgentTitle } from '../utils/agentTitle'
import { formatAgentResumeCommand } from '../utils/agentRegistry'
import { pruneScrollback } from '../utils/scrollbackStore'
import {
  SNAPSHOT_VERSION,
  loadSnapshot,
  saveSnapshot,
  type PersistedTab,
  type PersistedViewGroup,
  type SessionSnapshot,
} from '../utils/sessionStore'

interface PersistenceDeps {
  activeTabs?: { id: string; connId: string; name: string }[]
  ephemeralConns?: Connection[]
  viewGroups?: ViewGroup[]
  tabGroups?: Record<string, string>
  activeGroupId?: string
  layoutMode?: LayoutMode
}

const DEBOUNCE_MS = 1_000

export function useSessionPersistence({
  activeTabs = [],
  ephemeralConns = [],
  viewGroups = [],
  tabGroups = {},
  activeGroupId = 'ungrouped',
  layoutMode = 1,
}: PersistenceDeps = {}): { initialSnapshot: SessionSnapshot | null } {
  // Loaded exactly once, on the first render. A separate flag distinguishes "not yet loaded"
  // from "loaded and empty" — the snapshot value itself uses null for both, so the ref alone
  // cannot tell them apart.
  const initialSnapshotRef = useRef<SessionSnapshot | null>(null)
  const loadedRef = useRef(false)
  if (!loadedRef.current) {
    loadedRef.current = true
    initialSnapshotRef.current = loadSnapshot()
  }

  useEffect(() => {
    // Only persist LOCAL shell connections — SSH/RDP cannot be resumed.
    const localConns = (ephemeralConns ?? []).filter(c => c?.type === 'LOCAL')
    const localConnIds = new Set(localConns.map(c => c.id))
    const localTabs = (activeTabs ?? []).filter(t => localConnIds.has(t.connId))

    // Nothing worth writing if there are no local sessions.
    if (localConns.length === 0) return

    const localTabIds = new Set(localTabs.map(t => t.id))

    const timer = setTimeout(() => {
      // Strip non-local tabs from view-group pane arrays so slot positions
      // remain meaningful after restore (SSH/RDP tabs become null slots).
      const persistedGroups: PersistedViewGroup[] = (viewGroups ?? []).map(group => ({
        id: group.id,
        label: group.label,
        ...(group.color !== undefined ? { color: group.color } : {}),
        ...(group.persistent !== undefined ? { persistent: group.persistent } : {}),
        layoutMode: group.layoutMode,
        panes: (group.panes ?? []).map(id => (id !== null && localTabIds.has(id) ? id : null)),
        focusedPane: group.focusedPane,
      }))

      const persistedTabGroups: Record<string, string> = {}
      for (const [tabId, groupId] of Object.entries(tabGroups ?? {})) {
        if (localTabIds.has(tabId)) persistedTabGroups[tabId] = groupId
      }

      // Map connId → resume command for any tab that has an active agent.
      // Built alongside persistedTabs so the conn mapper below can look it up.
      const connResumeCommands = new Map<string, string>()

      const persistedTabs: PersistedTab[] = localTabs.map(tab => {
        const conn = localConns.find(c => c.id === tab.connId)
        const agentCtx = parseAgentTitle(tab.name) || parseAgentTitle(conn?.name)
        if (agentCtx) {
          const resumeCmd = formatAgentResumeCommand(agentCtx.agentName)
          if (resumeCmd) connResumeCommands.set(tab.connId, resumeCmd)
        }
        return {
          id: tab.id,
          connId: tab.connId,
          name: tab.name,
          scrollbackKey: `sb-${tab.id}`,
        }
      })

      const snapshot: SessionSnapshot = {
        version: SNAPSHOT_VERSION,
        activeTabs: persistedTabs,
        ephemeralConns: localConns.map(c => {
          const initialCommand = connResumeCommands.get(c.id)
          return {
            id: c.id,
            name: c.name,
            ...(c.shell !== undefined ? { shell: c.shell } : {}),
            ...(c.workspaceId !== undefined ? { workspaceId: c.workspaceId } : {}),
            ...(c.localCwd !== undefined ? { localCwd: c.localCwd } : {}),
            ...(initialCommand ? { initialCommand } : {}),
          }
        }),
        viewGroups: persistedGroups,
        tabGroups: persistedTabGroups,
        activeGroupId,
        layoutMode,
      }
      saveSnapshot(snapshot)
      // Drop scrollback buffers for tabs that no longer exist. Runs only on a real save — an
      // empty layout keeps whatever is stored so a pending restore can still find it.
      const liveKeys = new Set(persistedTabs.map(t => t.scrollbackKey ?? ''))
      void pruneScrollback(liveKeys)
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [activeTabs, ephemeralConns, viewGroups, tabGroups, activeGroupId, layoutMode])

  return { initialSnapshot: initialSnapshotRef.current }
}
