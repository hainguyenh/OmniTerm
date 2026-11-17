/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePluginsDialog } from '../../../ide/features/plugins/pluginsDialogStore'
import { buildPageTree, flatten } from '../../../ide/features/settings/model/pages'
import { hasSimpleView } from '../../../ide/features/settings/model/simpleView'
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
        list: () => Promise.resolve([]),
        builtinIds: () => Promise.resolve(['omniterm.todo-finder']),
        onChanged: () => () => {},
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
    registerSettingsPage({ id: 'tools.terminal', title: 'Terminal' })
    const java = registerSettingsPage({ id: 'languages.java', title: 'Java' })
    // Both plugin systems keep their Settings page; the page OmniTerm replaces is dropped.
    expect(ids()).toContain('plugins.extensions')
    expect(ids()).not.toContain('tools.terminal')
    // A switched-off language keeps its page registered, out of the tree, and the tree has a simple view.
    expect(ids()).toContain('languages.java')
    const tree = flatten(buildPageTree(useSettingsPages.getState().pages.values())).map((n) => n.key)
    expect(tree).not.toContain('languages.java')
    expect(tree).toContain(IDS.terminal)
    expect(hasSimpleView()).toBe(true)
    stop()
    expect(hasSimpleView()).toBe(false)
    extensions()
    java()
    expect(ids()).toEqual([])
    expect(usePluginsDialog.getState().source).toBeNull()
  })
})
