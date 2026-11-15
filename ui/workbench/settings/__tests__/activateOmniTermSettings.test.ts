/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePluginsDialog } from '../../../ide/features/plugins/pluginsDialogStore'
import { registerSettingsPage, useSettingsPages } from '../../../ide/workbench/contributions'
import { activateOmniTermSettings } from '../activateOmniTermSettings'
import { OMNITERM_SETTINGS_PAGES as IDS } from '../settingsPageIds'

afterEach(() => {
  useSettingsPages.setState({ pages: new Map() })
  vi.unstubAllGlobals()
})

describe('activateOmniTermSettings', () => {
  it('adds OmniTerm pages to the dialog and prunes the pages it does not cover, until released', async () => {
    vi.stubGlobal('omnitermAPI', {
      agentQuota: { info: () => Promise.resolve(false) },
      plugin: {
        invoke: () => Promise.reject(new Error('no plugin')),
        list: () => Promise.resolve([]),
        builtinIds: () => Promise.resolve(['omniterm.todo-finder']),
        onChanged: () => () => {},
        installPackage: () => Promise.resolve(null),
        restartApp: () => Promise.resolve(),
        setEnabled: () => Promise.resolve(null),
      },
    })
    ;(window as unknown as { omnitermAPI: unknown }).omnitermAPI = (globalThis as unknown as { omnitermAPI: unknown }).omnitermAPI
    const stop = activateOmniTermSettings()
    await new Promise((r) => setTimeout(r, 0))
    const ids = () => [...useSettingsPages.getState().pages.keys()]
    // The Plugins dialog lists OmniTerm's Node plugins and knows which IDE plugins are built in.
    expect(usePluginsDialog.getState().source?.builtinPluginIds).toEqual(['omniterm.todo-finder'])
    // The Ctrl+C rules live on the Terminal page; Plugins › Installed is OmniTerm's plugin manager.
    expect(ids()).toEqual(expect.arrayContaining([IDS.terminal, IDS.nodePlugins, IDS.about]))
    const extensions = registerSettingsPage({ id: 'plugins.extensions', title: 'Extensions' })
    registerSettingsPage({ id: 'languages.java', title: 'Java' })
    // Both plugin systems keep their Settings page; only the JVM pages are dropped.
    expect(ids()).toContain('plugins.extensions')
    expect(ids()).not.toContain('languages.java')
    stop()
    extensions()
    expect(ids()).toEqual([])
    expect(usePluginsDialog.getState().source).toBeNull()
  })
})
