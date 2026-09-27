import type { MainLayoutProps } from './mainLayoutShared'
import { useMainLayoutBase } from './useMainLayoutBase'
import { useMainLayoutSessions } from './useMainLayoutSessions'
import { useRenewSession } from '../hooks/useRenewSession'

export function useMainLayoutController(props: MainLayoutProps) {
  const base = useMainLayoutBase(props)
  const sessions = useMainLayoutSessions(base)
  const renew = useRenewSession({
    activeTabs: base.activeTabs,
    setActiveTabs: base.setActiveTabs,
    ephemeralConns: base.ephemeralConns,
    setEphemeralConns: base.setEphemeralConns,
    sessionCwds: base.sessionCwds,
    connById: base.connById,
    reconnectSession: sessions.reconnectSession,
    appSettings: base.appSettings,
    activeTabId: base.activeTabId,
    onError: (message) => { void base.showAlert(message, { title: 'Renew session', tone: 'error' }) },
  })
  return { ...base, ...sessions, ...renew }
}

export type MainLayoutModel = ReturnType<typeof useMainLayoutController>
