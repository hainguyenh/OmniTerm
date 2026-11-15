import { create } from 'zustand'

import { dockToolWindowSide, type QuotaDock } from '../../../plugins/agent-quota/app/quotaDock'
import { getQuotaState, quotaCommands, useQuota } from '../../../plugins/agent-quota/app/quotaStore'
import { toolWindowService } from '../../ide/workbench/contributions'

export const QUOTA_TOOL_WINDOW = 'omniterm.agentQuota'

/** Where quota shows right now: the configured dock while the plugin is present and on, else nowhere. */
export function effectiveDock(state: { available: boolean; config: { enabled: boolean; dock: QuotaDock } }): QuotaDock {
  return state.available && state.config.enabled ? state.config.dock : 'hidden'
}

export function useQuotaDock(): QuotaDock {
  return useQuota(effectiveDock)
}

/** The details popup of the tab strip line and the footer chips. */
export const useQuotaPopup = create<{ open: boolean }>(() => ({ open: false }))

export const toggleQuotaPopup = () => useQuotaPopup.setState((s) => ({ open: !s.open }))
export const closeQuotaPopup = () => useQuotaPopup.setState({ open: false })

/**
 * Moves the quota view (the mock's "Move to" buttons and Settings › Display). The legacy `footer`
 * flag follows, so older surfaces agree. A tool window dock opens the window, like the mock.
 */
export function setQuotaDock(dock: QuotaDock): void {
  const { config } = getQuotaState()
  if (config.dock !== dock) {
    quotaCommands().saveConfig({ ...config, dock, footer: dock === 'footer' || dock === 'both' })
  }
  if (dock !== 'footer') closeQuotaPopup()
  if (dockToolWindowSide(dock)) {
    // The tool window re-registers on its new side first; show it once that has happened.
    queueMicrotask(() => toolWindowService().show(QUOTA_TOOL_WINDOW, false))
  }
}
