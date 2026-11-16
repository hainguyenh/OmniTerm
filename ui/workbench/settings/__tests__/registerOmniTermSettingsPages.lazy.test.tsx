/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../OmniTermPages', () => {
  const stub = (name: string) => () => <div data-testid="page">{name}</div>
  return {
    TerminalPage: stub('TerminalPage'),
    AgentSessionsPage: stub('AgentSessionsPage'),
    GitUtilitiesPage: stub('GitUtilitiesPage'),
    FilesPage: stub('FilesPage'),
    BackupPage: stub('BackupPage'),
    ArtworkPage: stub('ArtworkPage'),
    EditorShortcutsPage: stub('EditorShortcutsPage'),
    BuiltinPluginsPage: stub('BuiltinPluginsPage'),
    AboutPage: stub('AboutPage'),
    AgentQuotaPage: stub('AgentQuotaPage'),
    AlwaysAwakePage: stub('AlwaysAwakePage'),
  }
})
vi.mock('../ShortcutsPage', () => ({ ShortcutsPage: () => <div data-testid="page">ShortcutsPage</div> }))

import { useSettingsPages } from '../../../ide/workbench/contributions'
import { registerOmniTermSettingsPages } from '../registerOmniTermSettingsPages'
import { OMNITERM_SETTINGS_PAGES as IDS } from '../settingsPageIds'

const EXPECTED: Array<[string, string]> = [
  [IDS.terminal, 'TerminalPage'],
  [IDS.agentSessions, 'AgentSessionsPage'],
  [IDS.gitUtilities, 'GitUtilitiesPage'],
  [IDS.files, 'FilesPage'],
  [IDS.backup, 'BackupPage'],
  [IDS.artwork, 'ArtworkPage'],
  [IDS.shortcuts, 'ShortcutsPage'],
  [IDS.editorShortcuts, 'EditorShortcutsPage'],
  [IDS.nodePlugins, 'BuiltinPluginsPage'],
  [IDS.about, 'AboutPage'],
  [IDS.agentQuota, 'AgentQuotaPage'],
  [IDS.alwaysAwake, 'AlwaysAwakePage'],
]

describe('registerOmniTermSettingsPages lazy views', () => {
  beforeEach(() => {
    useSettingsPages.setState({ pages: new Map() })
    ;(window as unknown as { omnitermAPI: unknown }).omnitermAPI = {
      agentQuota: { info: () => Promise.resolve(true) },
      alwaysAwake: { info: () => Promise.resolve(true) },
      plugin: { onChanged: () => () => {} },
    }
  })
  afterEach(cleanup)

  it.each(EXPECTED)('page %s loads the %s view', async (id, name) => {
    const stop = registerOmniTermSettingsPages()
    await waitFor(() => expect(useSettingsPages.getState().pages.has(id)).toBe(true))
    const Page = useSettingsPages.getState().pages.get(id)!.component as React.ComponentType
    const view = render(<Page />)
    await waitFor(() => expect(view.getByTestId('page').textContent).toBe(name))
    stop()
  })
})
