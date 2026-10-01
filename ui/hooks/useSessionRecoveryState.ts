import { useCallback, useState } from 'react'
import type { Connection } from '@omniterm/contract'
import type { LayoutMode } from '../themes'
import type { ViewGroup } from '../viewGroups'
import { useSessionPersistence } from './useSessionPersistence'
import { useSessionRestore } from './useSessionRestore'
import {
  removePendingSnapshotTabs,
  selectPendingSnapshotTabs,
  updatePendingSnapshot,
} from '../utils/sessionCheckpoint'
import type { PersistedTab, SessionSnapshot } from '../utils/sessionStore'
import type { RestoreOutcome } from '../utils/sessionRecoveryTypes'
import { parseAgentTitle } from '../utils/agentTitle'
import { findSessionByTabId, loadStoredSessions } from '../utils/agentSessionStorage'

type SessionTab = { id: string; connId: string; name: string }

const SHELL_ONLY_TITLES = new Set([
  'bash', 'cmd', 'command prompt', 'fish', 'powershell', 'pwsh', 'sh', 'zsh', 'windows powershell',
])

/** Plain shell panes are reconstruction metadata, not resumable work. Bookmarked agents use the explicit resume UI. */
export function shouldAutoRestoreTab(tab: PersistedTab): boolean {
  // A process-tree scan may have captured the agent before its terminal title changed back to a
  // shell title. The persisted session binding is stronger evidence than that transient title.
  if (findSessionByTabId(tab.id)) return true
  if (tab.recovery.cwd) {
    const cwd = tab.recovery.cwd.toLowerCase()
    if (loadStoredSessions().some(item => (item.state === 'interrupted' || item.state === 'active') && item.cwd && item.cwd.toLowerCase() === cwd)) {
      return true
    }
  }
  if (parseAgentTitle(tab.name)) return true
  const title = tab.name.trim().toLowerCase().replace(/^\/\/\s*/, '')
  const shellTitle = title.split(/\s+\/\/\s+/).at(-1) ?? title
  const powershellTitle = /^(?:windows\s+)?(?:power)?shell(?:\s+\d+(?:\.\d+)?)?$|^pwsh(?:\s+\d+(?:\.\d+)?)?$/
  return !SHELL_ONLY_TITLES.has(shellTitle) && !powershellTitle.test(shellTitle)
}

interface SessionRecoveryStateInput {
  activeTabs: SessionTab[]
  ephemeralConns: Connection[]
  resolveConnection: (id?: string) => Connection | undefined
  viewGroups: ViewGroup[]
  tabGroups: Record<string, string>
  activeGroupId: string
  layoutMode: LayoutMode
  sessionCwds: Record<string, string>
  setActiveTabs: (fn: (prev: SessionTab[]) => SessionTab[]) => void
  setEphemeralConns: (fn: (prev: Connection[]) => Connection[]) => void
  setTabGroups: (fn: (prev: Record<string, string>) => Record<string, string>) => void
  setResumeMode: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void
  restoreGroups: (groups: ViewGroup[], activeId: string) => void
  setPanes: (panes: (string | null)[]) => void
  setLayoutMode: (mode: LayoutMode) => void
  setFocusedPane: (pane: number) => void
}

export function useSessionRecoveryState(input: SessionRecoveryStateInput): {
  clearPendingRestore: (sessionIds: string[]) => void
  retryRestore: (sessionId?: string) => void
  markRestoreReady: (sessionId: string) => void
  markRestoreFailed: (sessionId: string, message?: string) => void
  restoreOutcomes: Record<string, RestoreOutcome>
} {
  const [pendingRestoreSnapshot, setPendingRestoreSnapshot] = useState<SessionSnapshot | null>(null)
  const [restoreOutcomes, setRestoreOutcomes] = useState<Record<string, RestoreOutcome>>({})
  const [closedRestoreIds, setClosedRestoreIds] = useState<ReadonlySet<string>>(new Set())
  const [retryRequest, setRetryRequest] = useState<{ snapshot: SessionSnapshot; token: number } | null>(null)

  const { initialSnapshot } = useSessionPersistence({
    activeTabs: input.activeTabs,
    ephemeralConns: input.ephemeralConns,
    resolveConnection: input.resolveConnection,
    viewGroups: input.viewGroups,
    tabGroups: input.tabGroups,
    activeGroupId: input.activeGroupId,
    layoutMode: input.layoutMode,
    sessionCwds: input.sessionCwds,
    pendingSnapshot: pendingRestoreSnapshot,
  })

  const currentSnapshot = retryRequest?.snapshot ?? initialSnapshot

  const retryRestore = useCallback((sessionId?: string) => {
    const source = pendingRestoreSnapshot ?? initialSnapshot
    if (!source) return
    const available = source.activeTabs.filter(tab => !closedRestoreIds.has(tab.id))
    const ids = sessionId ? new Set([sessionId]) : new Set(available.map(tab => tab.id))
    const snapshot = selectPendingSnapshotTabs({ ...source, activeTabs: available }, ids)
    if (!snapshot) return
    setRestoreOutcomes(previous => {
      const next = { ...previous }
      for (const id of ids) {
        next[id] = { phase: 'pending', message: 'Retrying fresh terminal startup.', retryable: false }
      }
      return next
    })
    setRetryRequest(previous => ({ snapshot, token: (previous?.token ?? 0) + 1 }))
  }, [closedRestoreIds, initialSnapshot, pendingRestoreSnapshot])

  const clearPendingRestore = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) return
    const removedIds = new Set(sessionIds)
    setClosedRestoreIds(previous => new Set([...previous, ...removedIds]))
    setPendingRestoreSnapshot(previous => removePendingSnapshotTabs(previous, removedIds))
    setRetryRequest(previous => {
      if (!previous) return previous
      const snapshot = removePendingSnapshotTabs(previous.snapshot, removedIds)
      return snapshot ? { ...previous, snapshot } : null
    })
    setRestoreOutcomes(previous => {
      const next = { ...previous }
      for (const id of removedIds) delete next[id]
      return next
    })
  }, [])

  const handleRestoreResult = useCallback((attemptedIds: string[]) => {
    if (!currentSnapshot) return
    const attempted = attemptedIds.filter(id => !closedRestoreIds.has(id))
    const attemptedSet = new Set(attempted)
    // Shell registration is not native startup acknowledgement. Keep every attempted pane in the
    // pending checkpoint until TerminalView reports connected or the user explicitly closes it.
    setPendingRestoreSnapshot(previous => updatePendingSnapshot(
      previous,
      currentSnapshot,
      attemptedSet,
      attemptedSet,
    ))
  }, [closedRestoreIds, currentSnapshot])

  const updateRestoreOutcomes = useCallback((next: Record<string, RestoreOutcome>) => {
    setRestoreOutcomes(previous => ({ ...previous, ...next }))
  }, [])

  const markRestoreReady = useCallback((sessionId: string) => {
    setPendingRestoreSnapshot(previous => removePendingSnapshotTabs(previous, new Set([sessionId])))
    setRestoreOutcomes(previous => {
      if (!previous[sessionId]) return previous
      const next = { ...previous }
      delete next[sessionId]
      return next
    })
  }, [])

  const markRestoreFailed = useCallback((sessionId: string, message = 'The terminal could not be started.') => {
    setRestoreOutcomes(previous => {
      if (!previous[sessionId]) return previous
      return {
        ...previous,
        [sessionId]: {
          phase: 'failed',
          message,
          retryable: true,
          action: 'retry-session',
        },
      }
    })
  }, [])


  useSessionRestore({
    initialSnapshot: currentSnapshot,
    existingTabs: input.activeTabs,
    existingEphemeralConns: input.ephemeralConns,
    isRestoreAllowed: sessionId => !closedRestoreIds.has(sessionId),
    shouldRestoreTab: shouldAutoRestoreTab,
    setActiveTabs: input.setActiveTabs,
    setEphemeralConns: input.setEphemeralConns,
    setTabGroups: input.setTabGroups,
    setResumeMode: input.setResumeMode,
    resolveConnection: input.resolveConnection,
    restoreGroups: input.restoreGroups,
    setPanes: input.setPanes,
    setLayoutMode: input.setLayoutMode,
    setFocusedPane: input.setFocusedPane,
    onRestoreResult: handleRestoreResult,
    setRestoreOutcomes: updateRestoreOutcomes,
    restoreLayout: retryRequest === null,
    retryToken: retryRequest?.token ?? 0,
  })

  return {
    clearPendingRestore,
    retryRestore,
    markRestoreReady,
    markRestoreFailed,
    restoreOutcomes,
  }
}
