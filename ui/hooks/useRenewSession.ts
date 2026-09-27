import { useCallback, useState } from 'react'
import type { Connection } from '@omniterm/contract'
import type { SessionTabItem } from '../components/SessionTabs'
import { findSessionByTabId, clearActiveForTab } from '../utils/agentSessionStorage'
import { formatAgentProfileCommand } from '../utils/agentRegistry'
import { diag } from '../diag'

let inMemoryRenewRemembered = false

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
}: UseRenewSessionOptions): UseRenewSessionReturn {
  const [pendingRenewSessionId, setPendingRenewSessionId] = useState<string | null>(null)

  const pendingRenewSessionName = pendingRenewSessionId
    ? activeTabs.find((tab) => tab.id === pendingRenewSessionId)?.name
    : undefined

  const executeRenew = useCallback(
    async (sessionId: string) => {
      const tab = activeTabs.find((t) => t.id === sessionId)
      if (!tab) return

      const strategy = appSettings.agentRenewStrategy ?? 'reopen'

      if (strategy === 'new-command') {
        window.omnitermAPI?.connect?.localInput?.(sessionId, '/new\r')
        return
      }

      const conn = connById(tab.connId)
      const stored = findSessionByTabId(sessionId)
      const cwd = sessionCwds[sessionId] ?? conn?.localCwd ?? stored?.cwd ?? null
      const command = formatAgentProfileCommand(
        stored?.agent,
        stored?.launcher,
        stored?.profileName,
      )

      try {
        await window.omnitermAPI?.connect?.localDisconnect?.(sessionId)
      } catch (err) {
        diag.warn('[useRenewSession] localDisconnect failed', err)
      }

      try {
        const opened = (await window.omnitermAPI?.shells?.open?.(
          conn?.shell,
          conn?.workspaceId ?? null,
          undefined,
          cwd,
          command ?? undefined,
        )) as Connection | null

        if (opened) {
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
        }
      } catch (err) {
        diag.error('[useRenewSession] shells.open failed', err)
      }
    },
    [
      activeTabs,
      appSettings.agentRenewStrategy,
      connById,
      ephemeralConns,
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

  return {
    renewModalOpen: pendingRenewSessionId !== null,
    pendingRenewSessionId,
    pendingRenewSessionName,
    requestRenewSession,
    confirmRenew,
    cancelRenew,
  }
}
