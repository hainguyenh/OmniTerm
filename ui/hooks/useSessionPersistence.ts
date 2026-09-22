/** Persist renderer layout metadata and each terminal's last working directory. */
import { useEffect, useRef } from 'react'
import type { Connection } from '@omniterm/contract'
import type { LayoutMode } from '../themes'
import type { ViewGroup } from '../viewGroups'
import {
  SNAPSHOT_VERSION,
  loadSnapshot,
  saveSnapshot,
  type PersistedConn,
  type PersistedTab,
  type PersistedViewGroup,
  type SessionSnapshot,
} from '../utils/sessionStore'
import { mergePendingSnapshot } from '../utils/sessionCheckpoint'

interface PersistenceDeps {
  activeTabs?: { id: string; connId: string; name: string }[]
  ephemeralConns?: Connection[]
  resolveConnection?: (id?: string) => Connection | undefined
  viewGroups?: ViewGroup[]
  tabGroups?: Record<string, string>
  activeGroupId?: string
  layoutMode?: LayoutMode
  sessionCwds?: Record<string, string>
  pendingSnapshot?: SessionSnapshot | null
}

type PtyTab = NonNullable<PersistenceDeps['activeTabs']>[number]

function buildSnapshot(
  ptyTabs: PtyTab[],
  connectionFor: (id: string) => Connection | undefined,
  ephemeralById: Map<string, Connection>,
  viewGroups: ViewGroup[],
  tabGroups: Record<string, string>,
  activeGroupId: string,
  layoutMode: LayoutMode,
  sessionCwds: Record<string, string>,
  pendingSnapshot: SessionSnapshot | null,
  revision: number,
): SessionSnapshot {
  const ptyTabIds = new Set(ptyTabs.map(tab => tab.id))
  const activeTabs: PersistedTab[] = ptyTabs.map(tab => {
    const conn = connectionFor(tab.connId)
    const cwd = sessionCwds[tab.id] ?? conn?.localCwd
    return {
      id: tab.id,
      connId: tab.connId,
      name: tab.name,
      recovery: {
        ...(cwd ? { cwd } : {}),
        cwdSource: sessionCwds[tab.id] ? 'reported' : conn?.localCwd ? 'launch' : 'unknown',
        ...(conn?.shell ? { shell: conn.shell } : {}),
      },
    }
  })

  const ephemeralConnsOut: PersistedConn[] = []
  const seen = new Set<string>()
  for (const tab of ptyTabs) {
    const conn = connectionFor(tab.connId)
    if (!conn || seen.has(conn.id)) continue
    seen.add(conn.id)
    ephemeralConnsOut.push({
      id: conn.id,
      name: conn.name,
      type: conn.type === 'SSH' ? 'SSH' : 'LOCAL',
      ephemeral: ephemeralById.has(conn.id),
      ...(conn.shell !== undefined ? { shell: conn.shell } : {}),
      ...(conn.workspaceId !== undefined ? { workspaceId: conn.workspaceId } : {}),
      ...(conn.localCwd !== undefined ? { localCwd: conn.localCwd } : {}),
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
    panes: group.panes.map(id => id && ptyTabIds.has(id) ? id : null),
    focusedPane: group.focusedPane,
  }))

  return mergePendingSnapshot({
    version: SNAPSHOT_VERSION,
    activeTabs,
    ephemeralConns: ephemeralConnsOut,
    viewGroups: persistedGroups,
    tabGroups: Object.fromEntries(Object.entries(tabGroups).filter(([tabId]) => ptyTabIds.has(tabId))),
    activeGroupId,
    layoutMode,
    revision,
  }, pendingSnapshot)
}

export function useSessionPersistence({
  activeTabs = [],
  ephemeralConns = [],
  resolveConnection,
  viewGroups = [],
  tabGroups = {},
  activeGroupId = 'ungrouped',
  layoutMode = 1,
  sessionCwds = {},
  pendingSnapshot = null,
}: PersistenceDeps = {}): { initialSnapshot: SessionSnapshot | null } {
  const initialSnapshotRef = useRef<SessionSnapshot | null>(null)
  const loadedRef = useRef(false)
  const revisionRef = useRef(0)
  const hadPtyTabsRef = useRef(false)

  if (!loadedRef.current) {
    loadedRef.current = true
    initialSnapshotRef.current = loadSnapshot()
    revisionRef.current = initialSnapshotRef.current?.revision ?? 0
  }

  useEffect(() => {
    const ephemeralById = new Map(ephemeralConns.map(conn => [conn.id, conn]))
    const connectionFor = (id: string) => ephemeralById.get(id) ?? resolveConnection?.(id)
    const ptyTabs = activeTabs.filter(tab => {
      const type = connectionFor(tab.connId)?.type
      return type === 'LOCAL' || type === 'SSH'
    })

    if (ptyTabs.length === 0 && !hadPtyTabsRef.current && !pendingSnapshot?.activeTabs.length) return
    hadPtyTabsRef.current = ptyTabs.length > 0 || Boolean(pendingSnapshot?.activeTabs.length)

    const saveCheckpoint = () => {
      saveSnapshot(buildSnapshot(
        ptyTabs,
        connectionFor,
        ephemeralById,
        viewGroups,
        tabGroups,
        activeGroupId,
        layoutMode,
        sessionCwds,
        pendingSnapshot,
        ++revisionRef.current,
      ))
    }

    // Save only reconstruction metadata. No terminal output or process state survives app exit.
    saveCheckpoint()
    window.addEventListener('pagehide', saveCheckpoint)
    window.addEventListener('beforeunload', saveCheckpoint)
    return () => {
      window.removeEventListener('pagehide', saveCheckpoint)
      window.removeEventListener('beforeunload', saveCheckpoint)
    }
  }, [activeTabs, ephemeralConns, resolveConnection, viewGroups, tabGroups, activeGroupId, layoutMode, sessionCwds, pendingSnapshot])

  return { initialSnapshot: initialSnapshotRef.current }
}
