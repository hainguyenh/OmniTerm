import { useCallback, useEffect, useState } from 'react'
import type { Connection } from '@omniterm/contract'
import type { SessionTabItem } from '../components/SessionTabs'
import { findSessionByTabId, clearActiveForTab } from '../utils/agentSessionStorage'
import { getPanePresence } from '../utils/agentPresenceStore'
import { formatAgentProfileCommand } from '../utils/agentRegistry'
import { diag } from '../diag'

const RENEW_EVENT = 'omniterm:renew-session'
/** How long after the swap an exit event from the old process is still attributed to the renew. */
const RENEW_SETTLE_MS = 2_000
/** Gap between typing the command and submitting it, so an agent TUI doesn't read one paste. */
const SUBMIT_DELAY_MS = 60

let inMemoryRenewRemembered = false
/**
 * Tabs mid-renew. Renew kills the pane's process before the fresh one is attached, and that exit
 * must not trigger the pane's normal close-on-exit policy — which closed the very tab being renewed.
 */
const renewing = new Set<string>()

export function isRenewing(sessionId: string): boolean {
  return renewing.has(sessionId)
}

/** Ask for a renew from anywhere (the pane header lives outside this hook's owner). */
export function requestRenewFromPane(sessionId: string): void {
  window.dispatchEvent(new CustomEvent<string>(RENEW_EVENT, { detail: sessionId }))
}

/** The in-agent command that starts a fresh conversation: Claude Code's `/clear`, Codex's `/new`. */
function newConversationCommand(agent: string | undefined): string {
  return agent === 'claude' || agent === 'agy' ? '/clear' : '/new'
}

export function resetRenewRememberedForTests(): void {
  inMemoryRenewRemembered = false
}

export function getRenewRemembered(): boolean {
  return inMemoryRenewRemembered
}

export function setRenewRemembered(value: boolean): void {
  inMemoryRenewRemembered = value
}

export interface UseRenewSessionOptions {
  activeTabs: SessionTabItem[]
  setActiveTabs: React.Dispatch<React.SetStateAction<SessionTabItem[]>>
  ephemeralConns: Connection[]
  setEphemeralConns: React.Dispatch<React.SetStateAction<Connection[]>>
  sessionCwds: Record<string, string>
  connById: (id: string) => Connection | undefined
  reconnectSession: (id: string) => void
  appSettings: { agentRenewStrategy?: 'reopen' | 'new-command' }
  activeTabId: string | null
  /** Shows a renew failure to the user; failures used to be logged only. */
  onError?: (message: string) => void
}

export interface UseRenewSessionReturn {
  renewModalOpen: boolean
  pendingRenewSessionId: string | null
  pendingRenewSessionName: string | undefined
  requestRenewSession: (sessionId?: string | null) => void
  confirmRenew: (remember: boolean) => Promise<void>
  cancelRenew: () => void
}

export function useRenewSession({
  activeTabs,
  setActiveTabs,
  ephemeralConns,
  setEphemeralConns,
  sessionCwds,
  connById,
  reconnectSession,
  appSettings,
  activeTabId,
  onError,
}: UseRenewSessionOptions): UseRenewSessionReturn {
  const [pendingRenewSessionId, setPendingRenewSessionId] = useState<string | null>(null)

  const pendingRenewSessionName = pendingRenewSessionId
    ? activeTabs.find((tab) => tab.id === pendingRenewSessionId)?.name
    : undefined

  const executeRenew = useCallback(
    async (sessionId: string) => {
      const tab = activeTabs.find((t) => t.id === sessionId)
      if (!tab) return

      const conn = connById(tab.connId)
      // Renew recreates a local process; SSH and RDP sessions have their own reconnect.
      if (conn?.type !== 'LOCAL') return
      const strategy = appSettings.agentRenewStrategy ?? 'reopen'
      const presence = getPanePresence(sessionId)

      if (strategy === 'new-command') {
        const input = window.omnitermAPI?.connect?.localInput
        input?.(sessionId, newConversationCommand(presence?.agent))
        window.setTimeout(() => input?.(sessionId, '\r'), SUBMIT_DELAY_MS)
        return
      }

      const stored = findSessionByTabId(sessionId)
      const cwd = sessionCwds[sessionId] ?? conn.localCwd ?? stored?.cwd ?? null
      // A pane whose Claude never wrote a session file has no stored entry, but the live process
      // tree still says which agent and profile to start fresh.
      const command = stored
        ? formatAgentProfileCommand(stored.agent, stored.launcher, stored.profileName)
        : presence
          ? formatAgentProfileCommand(presence.agent, presence.launcher, presence.profileName)
          : null

      renewing.add(sessionId)
      try {
        try {
          await window.omnitermAPI?.connect?.localDisconnect?.(sessionId)
        } catch (err) {
          diag.warn('[useRenewSession] localDisconnect failed', err)
        }

        const opened = (await window.omnitermAPI?.shells?.open?.(
          conn.shell,
          conn.workspaceId ?? null,
          undefined,
          cwd,
          command ?? undefined,
        )) as Connection | null
        if (!opened) {
          onError?.('A fresh terminal could not be started for this pane.')
          return
        }

        const oldConnId = tab.connId
        if (
          oldConnId &&
          oldConnId !== opened.id &&
          ephemeralConns.some((e) => e.id === oldConnId)
        ) {
          window.omnitermAPI?.shells?.release?.(oldConnId)
        }

        setEphemeralConns((prev) => [
          ...prev.filter((e) => e.id !== oldConnId),
          opened,
        ])
        setActiveTabs((prev) =>
          prev.map((t) =>
            t.id === sessionId ? { ...t, connId: opened.id } : t,
          ),
        )
        clearActiveForTab(sessionId)
        reconnectSession(sessionId)
      } catch (err) {
        diag.error('[useRenewSession] shells.open failed', err)
        onError?.(`Renew failed: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        window.setTimeout(() => renewing.delete(sessionId), RENEW_SETTLE_MS)
      }
    },
    [
      activeTabs,
      appSettings.agentRenewStrategy,
      connById,
      ephemeralConns,
      onError,
      reconnectSession,
      sessionCwds,
      setActiveTabs,
      setEphemeralConns,
    ],
  )

  const requestRenewSession = useCallback(
    (sessionId?: string | null) => {
      const targetId = sessionId ?? activeTabId
      if (!targetId) return

      if (inMemoryRenewRemembered) {
        void executeRenew(targetId)
      } else {
        setPendingRenewSessionId(targetId)
      }
    },
    [activeTabId, executeRenew],
  )

  const confirmRenew = useCallback(
    async (remember: boolean) => {
      if (remember) {
        inMemoryRenewRemembered = true
      }
      const targetId = pendingRenewSessionId
      setPendingRenewSessionId(null)
      if (targetId) {
        await executeRenew(targetId)
      }
    },
    [executeRenew, pendingRenewSessionId],
  )

  const cancelRenew = useCallback(() => {
    setPendingRenewSessionId(null)
  }, [])

  useEffect(() => {
    const onRequest = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail
      if (typeof id === 'string') requestRenewSession(id)
    }
    window.addEventListener(RENEW_EVENT, onRequest)
    return () => window.removeEventListener(RENEW_EVENT, onRequest)
  }, [requestRenewSession])

  return {
    renewModalOpen: pendingRenewSessionId !== null,
    pendingRenewSessionId,
    pendingRenewSessionName,
    requestRenewSession,
    confirmRenew,
    cancelRenew,
  }
}
