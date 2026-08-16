/**
 * useSessionRestore.ts — applies a persisted session snapshot once on mount.
 *
 * Each ephemeral LOCAL connection is re-registered with the Rust backend via
 * `shells.open()` to obtain a fresh adhoc-* id. Old ids from the snapshot are
 * mapped to fresh ids before populating activeTabs, panes, and view groups so
 * the rest of the layout machinery sees only valid, backend-known ids.
 *
 * SSH/RDP sessions are not restored — the remote side drops the connection when
 * the app closes and there is no silent re-auth path.
 */
import { useEffect } from 'react'
import type { Connection } from '@omniterm/contract'
import type { LayoutMode } from '../themes'
import type { ViewGroup } from '../viewGroups'
import { clearSnapshot, type SessionSnapshot } from '../utils/sessionStore'
import { deleteScrollback, loadScrollback, saveScrollback } from '../utils/scrollbackStore'
import { diag } from '../diag'

interface SessionRestoreInput {
  initialSnapshot: SessionSnapshot | null
  setActiveTabs: (fn: (prev: { id: string; connId: string; name: string }[]) => { id: string; connId: string; name: string }[]) => void
  setEphemeralConns: (fn: (prev: Connection[]) => Connection[]) => void
  setTabGroups: (fn: (prev: Record<string, string>) => Record<string, string>) => void
  restoreGroups: (groups: ViewGroup[], activeId: string) => void
  setPanes: (panes: (string | null)[]) => void
  setLayoutMode: (mode: LayoutMode) => void
  setFocusedPane: (pane: number) => void
}

export function useSessionRestore({
  initialSnapshot,
  setActiveTabs,
  setEphemeralConns,
  setTabGroups,
  restoreGroups,
  setPanes,
  setLayoutMode,
  setFocusedPane,
}: SessionRestoreInput): void {
  useEffect(() => {
    if (!initialSnapshot || initialSnapshot.activeTabs.length === 0) return

    let cancelled = false

    void (async () => {
      // Map old connId (adhoc-*) → newly registered Connection. Registration is independent
      // per connection, so they all run in parallel; a rejected open only drops that session.
      const results = await Promise.allSettled(
        initialSnapshot.ephemeralConns.map(async (persisted) => {
          const conn = await window.omnitermAPI.shells.open(
            persisted.shell,
            persisted.workspaceId ?? null,
            undefined,
            persisted.localCwd ?? null,
            persisted.initialCommand ?? null,
          ) as Connection | null
          if (!conn) throw new Error('shells.open returned no connection')
          return { oldId: persisted.id, conn }
        }),
      )
      const connMap = new Map<string, Connection>()
      for (const result of results) {
        if (result.status === 'rejected') {
          diag.warn('[useSessionRestore] could not re-register shell', result.reason)
        } else {
          connMap.set(result.value.oldId, result.value.conn)
        }
      }

      if (cancelled || connMap.size === 0) return

      // Map old tabId → new tabId using the remapped connId.
      const tabIdMap = new Map<string, string>()
      const newTabs: { id: string; connId: string; name: string }[] = []
      const newConns: Connection[] = []
      const scrollbackRekeys: Array<{ from: string; to: string }> = []

      for (const tab of initialSnapshot.activeTabs) {
        const conn = connMap.get(tab.connId)
        if (!conn) continue
        const newTabId = `${conn.id}_${crypto.randomUUID().slice(0, 8)}`
        tabIdMap.set(tab.id, newTabId)
        newTabs.push({ id: newTabId, connId: conn.id, name: tab.name })
        if (tab.scrollbackKey) scrollbackRekeys.push({ from: tab.scrollbackKey, to: `sb-${newTabId}` })
        if (!newConns.some(c => c.id === conn.id)) newConns.push(conn)
      }

      if (cancelled || newTabs.length === 0) return

      setEphemeralConns(prev => {
        const existing = new Set(prev.map(c => c.id))
        return [...prev, ...newConns.filter(c => !existing.has(c.id))]
      })

      setActiveTabs(prev => {
        const existing = new Set(prev.map(t => t.id))
        return [...prev, ...newTabs.filter(t => !existing.has(t.id))]
      })

      // Remap view-group pane arrays to use fresh tab ids.
      const restoredGroups: ViewGroup[] = initialSnapshot.viewGroups.map(group => ({
        ...group,
        panes: group.panes.map(id => (id !== null ? (tabIdMap.get(id) ?? null) : null)),
      }))

      // Remap tabGroups mapping.
      const restoredTabGroups: Record<string, string> = {}
      for (const [oldId, groupId] of Object.entries(initialSnapshot.tabGroups)) {
        const newId = tabIdMap.get(oldId)
        if (newId) restoredTabGroups[newId] = groupId
      }
      setTabGroups(() => restoredTabGroups)

      // Apply view groups and active group atomically.
      restoreGroups(restoredGroups, initialSnapshot.activeGroupId)

      // Restore pane layout for the active group.
      const activeGroup = restoredGroups.find(g => g.id === initialSnapshot.activeGroupId)
      if (activeGroup) {
        setPanes(activeGroup.panes)
        setLayoutMode(activeGroup.layoutMode)
        setFocusedPane(Math.min(activeGroup.focusedPane, activeGroup.layoutMode - 1))
      }

      diag.log('[useSessionRestore] restored', newTabs.length, 'session(s)')

      // Carry each restored tab's saved scrollback across the id remap, then consume the
      // snapshot. Consuming it here is what lets an emptied layout stay empty: persistence
      // never writes for an empty layout, so nothing re-creates the snapshot after this.
      for (const { from, to } of scrollbackRekeys) {
        const data = await loadScrollback(from)
        if (data) await saveScrollback(to, data)
        await deleteScrollback(from)
      }
      if (!cancelled) clearSnapshot()
    })()

    return () => { cancelled = true }
  }, []) // intentionally empty — runs once on mount to restore persisted sessions
}
