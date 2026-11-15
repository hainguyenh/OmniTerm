import { executeAction, getAction } from '../../ide/platform/actions'
import { diag } from '../../diag'

import { OMNITERM_SETTINGS_PAGES } from './settingsPageIds'

/** Settings tab ids the retired tabbed modal understood, mapped to the page that replaced them. */
export const LEGACY_TAB_PAGES: Readonly<Record<string, string>> = {
  general: OMNITERM_SETTINGS_PAGES.terminal,
  artwork: OMNITERM_SETTINGS_PAGES.artwork,
  shortcuts: OMNITERM_SETTINGS_PAGES.shortcuts,
  editorShortcuts: OMNITERM_SETTINGS_PAGES.editorShortcuts,
  plugins: OMNITERM_SETTINGS_PAGES.nodePlugins,
  quota: OMNITERM_SETTINGS_PAGES.agentQuota,
  about: OMNITERM_SETTINGS_PAGES.about,
}

let queued: { page?: string } | null = null

function run(page: string | undefined): void {
  if (getAction('file.settings')) {
    void executeAction('file.settings', page)
    return
  }
  diag.warn('[settings] the workbench is not mounted, so the Settings dialog cannot open yet')
}

/**
 * Opens the Settings dialog, on `page` when given. Requests made in the same tick coalesce, and one
 * that names a page wins: Agent Quota asks to "open settings" and then to show its tab, which must
 * open the dialog once, on that tab.
 */
export function openSettingsWindow(page?: string): void {
  if (queued) {
    queued.page ??= page
    return
  }
  queued = { page }
  setTimeout(() => {
    const request = queued
    queued = null
    run(request?.page)
  }, 0)
}
