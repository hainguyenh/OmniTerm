/** Persist renderer layout metadata, each terminal's last working directory, and resumable Claude sessions. */
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
import { detectPaneAgents, resolveClaudeSessionId, type DetectedPaneAgent } from '../utils/agentSessionDetector'
import { bindActiveSession, clearActiveForTab, findSessionByTabId, promoteStaleActiveSessions } from '../utils/agentSessionStorage'
import { hydrateAgentSessionStore } from '../utils/agentSessionDurable'
import { getPanePresence, isInRestoreGrace, setPanePresence, type PanePresence } from '../utils/agentPresenceStore'
import { extractAgentWorkItem } from '../utils/agentWorkItem'
import { parseAgentTitle } from '../utils/agentTitle'
import { agentBrandFor } from '../utils/agentIdentity'

/** How often each open pane's agent is re-detected and its Claude session file re-resolved. */
const AGENT_POLL_MS = 5_000

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

function launcherFor(found: { launcher?: string; profileName?: string; agent: string }): string | undefined {
  if (found.launcher) {
    if (found.launcher === 'agy-gemini') return undefined
    return found.launcher
  }
  if (
    !found.profileName ||
    found.profileName === found.agent ||
    found.profileName === 'agy-gemini' ||
    (found.agent === 'agy' && found.profileName === 'gemini') ||
    (found.agent === 'gemini' && found.profileName === 'gemini')
  ) {
    return undefined
  }
  return found.profileName.startsWith(`${found.agent}-`) ? found.profileName : `${found.agent}-${found.profileName}`
}

function presenceOf(found: { agent: DetectedPaneAgent['agent']; profileName: string; launcher?: string; pid: number; startTime: number }, sessionId?: string): PanePresence {
  return {
    agent: found.agent,
    profileName: found.profileName,
    ...(found.launcher ? { launcher: found.launcher } : {}),
    pid: found.pid,
    startTime: found.startTime,
    ...(sessionId ? { claudeSessionId: sessionId, agentSessionId: sessionId } : {}),
  }
}

function folderNameOf(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined
  const trimmed = cwd.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).filter(Boolean).pop()
}

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
  const previousTabIdsRef = useRef<Set<string>>(new Set())

  if (!loadedRef.current) {
    loadedRef.current = true
    initialSnapshotRef.current = loadSnapshot()
    revisionRef.current = initialSnapshotRef.current?.revision ?? 0
    // Any session still `active` belongs to a tab id from the previous run — whether that run ended
    // cleanly or was killed, this run has no such tab yet, so the session is now resumable.
    promoteStaleActiveSessions()
    // Merge the crash-safe copy: after a hard kill, localStorage may be missing the last writes.
    void hydrateAgentSessionStore()
  }

  // Layout/recovery snapshot: unrelated to which agent runs where, so it saves on its own schedule.
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

  // A closed tab's resumable-session tracking ends immediately — it does not wait for the next poll,
  // which only ever sees tabs that are still open.
  useEffect(() => {
    const currentIds = new Set(activeTabs.map(tab => tab.id))
    for (const previousId of previousTabIdsRef.current) {
      if (!currentIds.has(previousId)) clearActiveForTab(previousId)
    }
    previousTabIdsRef.current = currentIds
  }, [activeTabs])

  // Which AI agent (if any) runs under each open pane, from its process tree — never from terminal
  // output or a title guess. Only Claude resolves to a resumable session id in this pass.
  // Agents retitle their pane on every spinner frame, so the poll must not restart on a rename:
  // it keys on which tabs exist and reads their latest names through a ref.
  const latestTabsRef = useRef(activeTabs)
  latestTabsRef.current = activeTabs
  const tabsKey = activeTabs.map(tab => `${tab.id}:${tab.connId}`).join('|')
  useEffect(() => {
    const ephemeralById = new Map(ephemeralConns.map(conn => [conn.id, conn]))
    const connectionFor = (id: string) => ephemeralById.get(id) ?? resolveConnection?.(id)
    let cancelled = false
    let inFlight = false

    const poll = async () => {
      const activeTabs = latestTabsRef.current
      if (inFlight || activeTabs.length === 0) return
      inFlight = true
      try {
        const detected = await detectPaneAgents()
        if (cancelled) return
        const byTabId = new Map(detected.map(entry => [entry.sessionId, entry]))
        const nextPresence: Record<string, PanePresence> = {}
        for (const tab of activeTabs) {
          const found = byTabId.get(tab.id)
          if (!found) {
            const conn = connectionFor(tab.connId)
            const parsed = parseAgentTitle(tab.name) || parseAgentTitle(conn?.name) || parseAgentTitle((conn as { localCommand?: string })?.localCommand)
            const brand = parsed ? agentBrandFor(parsed.agentName) : null
            if (brand) {
              const cwd = sessionCwds[tab.id] ?? connectionFor(tab.connId)?.localCwd
              const previous = getPanePresence(tab.id)
              const stored = findSessionByTabId(tab.id)
              const agentSessionId = previous?.agentSessionId ?? previous?.claudeSessionId ?? stored?.sessionId ?? (brand === 'claude' ? undefined : 'latest')
              if (agentSessionId) {
                nextPresence[tab.id] = {
                  agent: brand,
                  profileName: previous?.profileName ?? stored?.profileName ?? brand,
                  pid: previous?.pid ?? 0,
                  startTime: previous?.startTime ?? 0,
                  agentSessionId,
                  ...(brand === 'claude' ? { claudeSessionId: agentSessionId } : {}),
                }
                const title = extractAgentWorkItem(tab.name)
                bindActiveSession({
                  id: `${brand}:${agentSessionId === 'latest' ? `${brand}-${tab.id}` : agentSessionId}`,
                  tabId: tab.id,
                  agent: brand,
                  launcher: stored?.launcher,
                  profileName: previous?.profileName ?? stored?.profileName ?? brand,
                  sessionId: agentSessionId,
                  cwd,
                  folderName: folderNameOf(cwd),
                  ...(title ? { title } : {}),
                  state: 'active',
                  updatedAt: Date.now(),
                })
                continue
              }
            }
            // No agent process under this pane anymore (never had one, or it exited) — nothing to
            // track. A pane just recreated by restore is spared: its `--resume` may not be up yet.
            if (!isInRestoreGrace(tab.id)) clearActiveForTab(tab.id)
            continue
          }
          const previous = getPanePresence(tab.id)
          const sameProcess = previous?.pid === found.pid && previous.startTime === found.startTime
          const priorSessionId = sameProcess ? (previous.agentSessionId ?? previous.claudeSessionId) : undefined
          nextPresence[tab.id] = presenceOf(found, priorSessionId)
          const cwd = sessionCwds[tab.id] ?? connectionFor(tab.connId)?.localCwd
          let sessionId = priorSessionId
          if (found.agent === 'claude') {
            sessionId = (await resolveClaudeSessionId(found, cwd)) ?? priorSessionId
            if (cancelled) return
          } else if (!sessionId) {
            sessionId = 'latest'
          }
          if (!sessionId) continue
          nextPresence[tab.id] = presenceOf(found, sessionId)
          const title = extractAgentWorkItem(tab.name)
          bindActiveSession({
            id: `${found.agent}:${sessionId === 'latest' ? `${found.agent}-${tab.id}` : sessionId}`,
            tabId: tab.id,
            agent: found.agent,
            launcher: launcherFor(found),
            profileName: found.profileName,
            sessionId,
            cwd,
            folderName: folderNameOf(cwd),
            ...(title ? { title } : {}),
            state: 'active',
            updatedAt: Date.now(),
          })
        }
        setPanePresence(nextPresence)
      } finally {
        inFlight = false
      }
    }

    void poll()
    const interval = window.setInterval(() => void poll(), AGENT_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [tabsKey, ephemeralConns, resolveConnection, sessionCwds])

  return { initialSnapshot: initialSnapshotRef.current }
}
