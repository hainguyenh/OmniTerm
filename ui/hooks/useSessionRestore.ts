/** Recreate saved pane/tab layout with fresh terminal processes at the saved working directories. */
import { useEffect, useRef } from 'react'
import type { Connection } from '@omniterm/contract'
import type { LayoutMode } from '../themes'
import type { ViewGroup } from '../viewGroups'
import { type PersistedConn, type SessionSnapshot } from '../utils/sessionStore'
import { selectPendingSnapshotTabs } from '../utils/sessionCheckpoint'
import { diag } from '../diag'
import type { RestoreOutcome } from '../utils/sessionRecoveryTypes'

interface SessionRestoreInput {
  initialSnapshot: SessionSnapshot | null
  existingTabs?: { id: string; connId: string; name: string }[]
  existingEphemeralConns?: Connection[]
  isRestoreAllowed?: (sessionId: string) => boolean
  setActiveTabs: (fn: (prev: { id: string; connId: string; name: string }[]) => { id: string; connId: string; name: string }[]) => void
  setEphemeralConns: (fn: (prev: Connection[]) => Connection[]) => void
  setTabGroups: (fn: (prev: Record<string, string>) => Record<string, string>) => void
  setResumeMode: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void
  setRestoreOutcomes?: (outcomes: Record<string, RestoreOutcome>) => void
  onRestoreResult?: (attemptedIds: string[], unresolvedIds: string[]) => void
  restoreLayout?: boolean
  retryToken?: number
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

function groupsForSnapshot(snapshot: SessionSnapshot): ViewGroup[] {
  const ids = new Set(snapshot.activeTabs.map(tab => tab.id))
  return snapshot.viewGroups.map(group => ({
    ...group,
    panes: group.panes.map(pane => pane && ids.has(pane) ? pane : null),
  }))
}

export function useSessionRestore(input: SessionRestoreInput): void {
  const latestInput = useRef(input)
  latestInput.current = input
  const { initialSnapshot, retryToken = 0 } = input

  useEffect(() => {
    const current = latestInput.current
    if (!initialSnapshot || initialSnapshot.activeTabs.length === 0) return
    let cancelled = false

    const allowedIds = new Set(initialSnapshot.activeTabs
      .filter(tab => current.isRestoreAllowed?.(tab.id) !== false)
      .map(tab => tab.id))
    const snapshot = selectPendingSnapshotTabs(initialSnapshot, allowedIds)
    if (!snapshot) return

    current.setRestoreOutcomes?.(Object.fromEntries(snapshot.activeTabs.map(tab => [tab.id, {
      phase: 'pending',
      message: 'Restoring pane layout and working directory.',
      retryable: false,
    }])))

    void (async () => {
      const savedConnById = new Map(snapshot.ephemeralConns.map(conn => [conn.id, conn]))
      const restoredConns = new Map<string, Connection>()
      const restoredTabs: { id: string; connId: string; name: string }[] = []
      const outcomes: Record<string, RestoreOutcome> = {}
      const unresolvedIds: string[] = []
      const attemptedIds: string[] = []

      for (const tab of snapshot.activeTabs) {
        if (cancelled || latestInput.current.isRestoreAllowed?.(tab.id) === false) continue
        attemptedIds.push(tab.id)

        const savedConn = savedConnById.get(tab.connId)
        let conn = current.resolveConnection?.(tab.connId)
          ?? (savedConn ? connectionFromSnapshot(savedConn) : undefined)

        // Never reattach old process state. If a stale daemon session exists under this tab id,
        // kill it first, then reconstruct the pane with a fresh shell.
        await window.omnitermAPI.connect.localDisconnect(tab.id)

        if ((savedConn?.type ?? conn?.type) === 'LOCAL' && savedConn) {
          try {
            const opened = await window.omnitermAPI.shells.open(
              savedConn.shell ?? tab.recovery.shell,
              savedConn.workspaceId ?? null,
              undefined,
              tab.recovery.cwd ?? savedConn.localCwd ?? null,
              null,
            ) as Connection | null
            if (opened) conn = opened
            else conn = undefined
          } catch (error) {
            diag.warn('[useSessionRestore] fresh shell registration failed', error)
            conn = undefined
          }
        }

        if (cancelled || latestInput.current.isRestoreAllowed?.(tab.id) === false) {
          if (conn && savedConn && conn.id !== savedConn.id) window.omnitermAPI.shells.release(conn.id)
          continue
        }

        if (!conn) {
          unresolvedIds.push(tab.id)
          restoredTabs.push({ id: tab.id, connId: tab.connId, name: tab.name })
          outcomes[tab.id] = {
            phase: 'failed',
            message: 'The pane could not start a fresh terminal. Retry when the shell is available.',
            retryable: true,
            action: 'retry-session',
          }
          continue
        }

        restoredConns.set(conn.id, conn)
        restoredTabs.push({ id: tab.id, connId: conn.id, name: tab.name })
        outcomes[tab.id] = {
          phase: 'recovering',
          message: 'Starting a fresh terminal in the saved folder.',
          retryable: false,
        }
      }

      if (cancelled || attemptedIds.length === 0) return
      latestInput.current.onRestoreResult?.(attemptedIds, unresolvedIds)
      if (restoredTabs.length === 0) return

      const restoredById = new Map(restoredTabs.map(tab => [tab.id, tab]))
      const existingTabs = latestInput.current.existingTabs ?? []
      const resultingConnIds = new Set(existingTabs.map(tab => restoredById.get(tab.id)?.connId ?? tab.connId))
      for (const tab of restoredTabs) resultingConnIds.add(tab.connId)
      const replacedConnIds = new Set(existingTabs.flatMap(tab => {
        const restored = restoredById.get(tab.id)
        return restored && restored.connId !== tab.connId ? [tab.connId] : []
      }))
      for (const conn of latestInput.current.existingEphemeralConns ?? []) {
        if (replacedConnIds.has(conn.id) && !resultingConnIds.has(conn.id)) {
          window.omnitermAPI.shells.release(conn.id)
        }
      }

      current.setEphemeralConns(previous => {
        const retained = previous.filter(conn => !replacedConnIds.has(conn.id) || resultingConnIds.has(conn.id))
        const ids = new Set(retained.map(conn => conn.id))
        return [...retained, ...[...restoredConns.values()].filter(conn => !ids.has(conn.id))]
      })
      current.setActiveTabs(previous => {
        const ids = new Set(previous.map(tab => tab.id))
        const updated = previous.map(tab => restoredById.get(tab.id) ?? tab)
        return [...updated, ...restoredTabs.filter(tab => !ids.has(tab.id))]
      })
      current.setResumeMode(previous => ({
        ...previous,
        ...Object.fromEntries(restoredTabs.map(tab => [tab.id, false])),
      }))

      if (current.restoreLayout !== false) {
        current.setTabGroups(() => ({ ...snapshot.tabGroups }))
        const groups = groupsForSnapshot(snapshot)
        current.restoreGroups(groups, snapshot.activeGroupId)
        const activeGroup = groups.find(group => group.id === snapshot.activeGroupId)
        if (activeGroup) {
          current.setPanes(activeGroup.panes)
          current.setLayoutMode(activeGroup.layoutMode)
          current.setFocusedPane(Math.min(activeGroup.focusedPane, activeGroup.layoutMode - 1))
        }
      }

      current.setRestoreOutcomes?.(outcomes)
      diag.log('[useSessionRestore] recreated', restoredTabs.length, 'terminal pane(s)')
    })()

    return () => { cancelled = true }
  }, [initialSnapshot, retryToken])
}
