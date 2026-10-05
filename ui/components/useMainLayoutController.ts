import type { MainLayoutProps } from './mainLayoutShared'
import { useMainLayoutBase } from './useMainLayoutBase'
import { useMainLayoutSessions } from './useMainLayoutSessions'
import { useRenewSession } from '../hooks/useRenewSession'
import { useTempNotes } from '../hooks/useTempNotes'

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
  const tempNotes = useTempNotes({
    activeTabs: base.activeTabs,
    setActiveTabs: base.setActiveTabs,
    setEditorTabs: base.setEditorTabs,
    showTab: sessions.showTab,
  })
  return { ...base, ...sessions, ...renew, ...tempNotes }
}

export type MainLayoutModel = ReturnType<typeof useMainLayoutController>
