/** Persist enough renderer metadata to reattach daemon PTYs or safely reconstruct them after reboot. */
import { useEffect, useRef } from 'react'
import type { Connection } from '@omniterm/contract'
import type { LayoutMode } from '../themes'
import type { ViewGroup } from '../viewGroups'
import { parseAgentTitle } from '../utils/agentTitle'
import { formatAgentResumeCommand } from '../utils/agentRegistry'
import { getPersistencePolicy } from '../utils/persistencePolicy'
import { pruneScrollback } from '../utils/scrollbackStore'
import {
  SNAPSHOT_VERSION,
  loadSnapshot,
  saveSnapshot,
  type PersistedConn,
  type PersistedTab,
  type PersistedViewGroup,
  type SessionSnapshot,
} from '../utils/sessionStore'

interface PersistenceDeps {
  activeTabs?: { id: string; connId: string; name: string }[]
  ephemeralConns?: Connection[]
  resolveConnection?: (id?: string) => Connection | undefined
  viewGroups?: ViewGroup[]
  tabGroups?: Record<string, string>
  activeGroupId?: string
  layoutMode?: LayoutMode
}

type PtyTab = NonNullable<PersistenceDeps['activeTabs']>[number]

const DEBOUNCE_MS = 1_000

function buildSnapshot(
  ptyTabs: PtyTab[],
  connectionFor: (id: string) => Connection | undefined,
  ephemeralById: Map<string, Connection>,
  previousById: Map<string, PersistedTab>,
  daemonGenerationById: Map<string, number>,
  viewGroups: ViewGroup[],
  tabGroups: Record<string, string>,
  activeGroupId: string,
  layoutMode: LayoutMode,
): SessionSnapshot {
  const ptyTabIds = new Set(ptyTabs.map(tab => tab.id))
  const resumeCommands = new Map<string, string>()
  const persistedTabs: PersistedTab[] = ptyTabs.map(tab => {
    const conn = connectionFor(tab.connId)
    const agent = parseAgentTitle(tab.name) ?? parseAgentTitle(conn?.name)
    const policy = getPersistencePolicy(tab.id, agent !== null)
    const resumeCommand = agent ? formatAgentResumeCommand(agent.agentName) : null
    // Safe allowlisted agent recipes can be checkpointed regardless of the current policy. Restore
    // still gates execution on recover-after-reboot, so a later policy toggle cannot lose the recipe.
    if (resumeCommand) resumeCommands.set(tab.connId, resumeCommand)
    return {
      id: tab.id,
      sessionId: tab.id,
      generation: daemonGenerationById.get(tab.id) ?? previousById.get(tab.id)?.generation ?? 1,
      persistencePolicy: policy,
      connId: tab.connId,
      name: tab.name,
      scrollbackKey: `sb-${tab.id}`,
    }
  })

  const persistedConns: PersistedConn[] = []
  const seenConns = new Set<string>()
  for (const tab of ptyTabs) {
    const conn = connectionFor(tab.connId)
    if (!conn || seenConns.has(conn.id)) continue
    seenConns.add(conn.id)
    const initialCommand = resumeCommands.get(conn.id)
    persistedConns.push({
      id: conn.id,
      name: conn.name,
      type: conn.type === 'SSH' ? 'SSH' : 'LOCAL',
      ephemeral: ephemeralById.has(conn.id),
      ...(conn.shell !== undefined ? { shell: conn.shell } : {}),
      ...(conn.workspaceId !== undefined ? { workspaceId: conn.workspaceId } : {}),
      ...(conn.localCwd !== undefined ? { localCwd: conn.localCwd } : {}),
      ...(initialCommand ? { initialCommand } : {}),
      ...(conn.host ? { host: conn.host } : {}),
      ...(conn.port ? { port: conn.port } : {}),
      ...(conn.user ? { user: conn.user } : {}),
    })
  }

  const persistedGroups: PersistedViewGroup[] = viewGroups.map(group => ({
    id: group.id,
    label: group.label,
    ...(group.color !== undefined ? { color: group.color } : {}),
    ...(group.persistent !== undefined ? { persistent: group.persistent } : {}),
    layoutMode: group.layoutMode,
    panes: group.panes.map(id => (id !== null && ptyTabIds.has(id) ? id : null)),
    focusedPane: group.focusedPane,
  }))
  const persistedTabGroups: Record<string, string> = {}
  for (const [tabId, groupId] of Object.entries(tabGroups)) {
    if (ptyTabIds.has(tabId)) persistedTabGroups[tabId] = groupId
  }

  return {
    version: SNAPSHOT_VERSION,
    activeTabs: persistedTabs,
    ephemeralConns: persistedConns,
    viewGroups: persistedGroups,
    tabGroups: persistedTabGroups,
    activeGroupId,
    layoutMode,
  }
}

export function useSessionPersistence({
  activeTabs = [],
  ephemeralConns = [],
  resolveConnection,
  viewGroups = [],
  tabGroups = {},
  activeGroupId = 'ungrouped',
  layoutMode = 1,
}: PersistenceDeps = {}): { initialSnapshot: SessionSnapshot | null } {
  const initialSnapshotRef = useRef<SessionSnapshot | null>(null)
  const loadedRef = useRef(false)
  const structuralSignatureRef = useRef('')
  if (!loadedRef.current) {
    loadedRef.current = true
    initialSnapshotRef.current = loadSnapshot()
  }

  useEffect(() => {
    const ephemeralById = new Map(ephemeralConns.map(conn => [conn.id, conn]))
    const connectionFor = (id: string) => ephemeralById.get(id) ?? resolveConnection?.(id)
    const ptyTabs = activeTabs.filter(tab => {
      const type = connectionFor(tab.connId)?.type
      return type === 'LOCAL' || type === 'SSH'
    })
    if (ptyTabs.length === 0) return

    const previousById = new Map<string, PersistedTab>()
    for (const tab of initialSnapshotRef.current?.activeTabs ?? []) previousById.set(tab.sessionId, tab)
    const noDaemonGenerations = new Map<string, number>()
    const saveCheckpoint = (generations = noDaemonGenerations) => {
      const snapshot = buildSnapshot(
        ptyTabs, connectionFor, ephemeralById, previousById, generations,
        viewGroups, tabGroups, activeGroupId, layoutMode,
      )
      saveSnapshot(snapshot)
      void pruneScrollback(new Set(snapshot.activeTabs.map(tab => tab.scrollbackKey ?? '')))
    }

    // A new/renamed PTY is checkpointed synchronously. This closes the one-second window where the
    // daemon could keep a brand-new PTY alive after GUI exit but the next GUI had no tab id to attach.
    const structuralSignature = ptyTabs.map(tab => {
      const conn = connectionFor(tab.connId)
      const agent = parseAgentTitle(tab.name) ?? parseAgentTitle(conn?.name)
      return `${tab.id}\0${tab.connId}\0${tab.name}\0${getPersistencePolicy(tab.id, agent !== null)}`
    }).join('\u0001')
    if (structuralSignatureRef.current !== structuralSignature) {
      structuralSignatureRef.current = structuralSignature
      saveCheckpoint()
    }

    // Policy synchronization is immediate; it must not depend on the debounced rich checkpoint.
    for (const tab of ptyTabs) {
      const conn = connectionFor(tab.connId)
      const agent = parseAgentTitle(tab.name) ?? parseAgentTitle(conn?.name)
      const policy = getPersistencePolicy(tab.id, agent !== null)
      const update = window.omnitermAPI?.connect?.setPersistencePolicy?.(tab.id, policy)
      void update?.catch(() => {})
    }

    // Flush the latest pane/group layout synchronously as the webview goes away. The daemon already
    // owns terminal bytes; this checkpoint only has non-secret reconstruction metadata.
    const onPageExit = () => saveCheckpoint()
    window.addEventListener('pagehide', onPageExit)
    window.addEventListener('beforeunload', onPageExit)

    const timer = setTimeout(() => {
      void (async () => {
        const daemonSessions = typeof window !== 'undefined'
          ? await window.omnitermAPI?.connect?.listLocalSessions?.() ?? []
          : []
        const generations = new Map<string, number>()
        for (const session of daemonSessions) generations.set(session.id, session.generation)
        saveCheckpoint(generations)
      })()
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('pagehide', onPageExit)
      window.removeEventListener('beforeunload', onPageExit)
    }
  }, [activeTabs, ephemeralConns, resolveConnection, viewGroups, tabGroups, activeGroupId, layoutMode])

  return { initialSnapshot: initialSnapshotRef.current }
}
