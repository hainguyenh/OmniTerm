/** Restore saved PTY tabs by reattaching live daemon sessions before considering any cold launch. */
import { useEffect } from 'react'
import type { Connection } from '@omniterm/contract'
import type { LayoutMode } from '../themes'
import type { ViewGroup } from '../viewGroups'
import { clearSnapshot, type PersistedConn, type SessionSnapshot } from '../utils/sessionStore'
import { diag } from '../diag'
import {
  getPersistencePolicy,
  hasExplicitPersistencePolicy,
} from '../utils/persistencePolicy'

interface SessionRestoreInput {
  initialSnapshot: SessionSnapshot | null
  setActiveTabs: (fn: (prev: { id: string; connId: string; name: string }[]) => { id: string; connId: string; name: string }[]) => void
  setEphemeralConns: (fn: (prev: Connection[]) => Connection[]) => void
  setTabGroups: (fn: (prev: Record<string, string>) => Record<string, string>) => void
  setResumeMode: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void
  resolveConnection?: (id?: string) => Connection | undefined
  restoreGroups: (groups: ViewGroup[], activeId: string) => void
  setPanes: (panes: (string | null)[]) => void
  setLayoutMode: (mode: LayoutMode) => void
  setFocusedPane: (pane: number) => void
}

function connectionFromSnapshot(conn: PersistedConn): Connection {
  return {
    id: conn.id,
    name: conn.name,
    type: conn.type ?? 'LOCAL',
    host: conn.host ?? '',
    port: conn.port ?? '',
    user: conn.user ?? '',
    ...(conn.shell ? { shell: conn.shell as Connection['shell'] } : {}),
    ...(conn.workspaceId ? { workspaceId: conn.workspaceId } : {}),
    ...(conn.localCwd ? { localCwd: conn.localCwd } : {}),
  }
}

export function useSessionRestore({
  initialSnapshot,
  setActiveTabs,
  setEphemeralConns,
  setTabGroups,
  setResumeMode,
  resolveConnection,
  restoreGroups,
  setPanes,
  setLayoutMode,
  setFocusedPane,
}: SessionRestoreInput): void {
  useEffect(() => {
    if (!initialSnapshot || initialSnapshot.activeTabs.length === 0) return
    let cancelled = false

    void (async () => {
      const daemonSessions = await window.omnitermAPI?.connect?.listLocalSessions?.() ?? []
      const daemonById = new Map<string, (typeof daemonSessions)[number]>()
      for (const session of daemonSessions) daemonById.set(session.id, session)
      const savedConnById = new Map(initialSnapshot.ephemeralConns.map(conn => [conn.id, conn]))
      const restoredConns = new Map<string, Connection>()
      const restoredTabs: { id: string; connId: string; name: string }[] = []
      const attachMode: Record<string, boolean> = {}

      for (const tab of initialSnapshot.activeTabs) {
        const daemonSession = daemonById.get(tab.sessionId)
        const live = daemonSession?.lifecycle === 'live'
        const savedConn = savedConnById.get(tab.connId)
        const localPolicy = getPersistencePolicy(tab.id)
        const policy = daemonSession?.policy
          ?? (hasExplicitPersistencePolicy(tab.id) ? localPolicy : tab.persistencePolicy)
        let conn = resolveConnection?.(tab.connId) ?? (savedConn ? connectionFromSnapshot(savedConn) : undefined)

        if (live) {
          if (!conn) continue
          restoredConns.set(conn.id, conn)
          restoredTabs.push({ id: tab.id, connId: conn.id, name: tab.name })
          attachMode[tab.id] = true
          continue
        }

        const recover = policy === 'recover-after-reboot'
          && (!daemonSession || daemonSession.lifecycle === 'interrupted')

        if (savedConn && (savedConn.type ?? 'LOCAL') === 'LOCAL') {
          const needsRegistration = savedConn.ephemeral || (recover && !!savedConn.initialCommand)
          if (needsRegistration) {
            try {
              conn = undefined
              const opened = await window.omnitermAPI.shells.open(
                savedConn.shell,
                savedConn.workspaceId ?? null,
                undefined,
                savedConn.localCwd ?? null,
                recover ? savedConn.initialCommand ?? null : null,
              ) as Connection | null
              if (opened) conn = opened
            } catch (error) {
              diag.warn('[useSessionRestore] shell registration failed', error)
            }
          }
        }

        if (!conn) continue
        restoredConns.set(conn.id, conn)
        restoredTabs.push({ id: tab.id, connId: conn.id, name: tab.name })
        // Non-recover policies stay stopped. Recoverable tabs start a new daemon generation.
        attachMode[tab.id] = !recover
      }

      if (cancelled || restoredTabs.length === 0) return

      setEphemeralConns(prev => {
        const existing = new Set(prev.map(conn => conn.id))
        return [...prev, ...[...restoredConns.values()].filter(conn => !existing.has(conn.id))]
      })
      setActiveTabs(prev => {
        const existing = new Set(prev.map(tab => tab.id))
        return [...prev, ...restoredTabs.filter(tab => !existing.has(tab.id))]
      })
      setResumeMode(prev => ({ ...prev, ...attachMode }))

      const restoredIds = new Set(restoredTabs.map(tab => tab.id))
      const restoredGroups: ViewGroup[] = initialSnapshot.viewGroups.map(group => ({
        ...group,
        panes: group.panes.map(id => (id !== null && restoredIds.has(id) ? id : null)),
      }))
      const restoredTabGroups: Record<string, string> = {}
      for (const [tabId, groupId] of Object.entries(initialSnapshot.tabGroups)) {
        if (restoredIds.has(tabId)) restoredTabGroups[tabId] = groupId
      }
      setTabGroups(() => restoredTabGroups)
      restoreGroups(restoredGroups, initialSnapshot.activeGroupId)

      const activeGroup = restoredGroups.find(group => group.id === initialSnapshot.activeGroupId)
      if (activeGroup) {
        setPanes(activeGroup.panes)
        setLayoutMode(activeGroup.layoutMode)
        setFocusedPane(Math.min(activeGroup.focusedPane, activeGroup.layoutMode - 1))
      }

      diag.log('[useSessionRestore] restored', restoredTabs.length, 'PTY session(s)')
      if (!cancelled) clearSnapshot()
    })()

    return () => { cancelled = true }
  }, []) // startup-only restore
}
