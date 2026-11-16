import { useEffect } from 'react'

import { SETTINGS_TAB_EVENT } from '../../features/agent-quota/AgentQuotaRoot'

import { LEGACY_TAB_PAGES, openSettingsWindow } from './openSettingsWindow'

/**
 * Opens the Settings dialog, on the matching page, when the legacy tab event (Agent Quota's
 * "Settings" link) asks for a settings tab.
 */
export function useSettingsWindowRedirect(): void {
  useEffect(() => {
    const onTab = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab
      openSettingsWindow(tab ? LEGACY_TAB_PAGES[tab] : undefined)
    }
    window.addEventListener(SETTINGS_TAB_EVENT, onTab)
    return () => window.removeEventListener(SETTINGS_TAB_EVENT, onTab)
  }, [])
}
