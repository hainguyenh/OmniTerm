import { OmniTermPluginDetails } from '../plugins/OmniTermPluginDetails'
import { registerOmniTermPluginSource } from '../plugins/omnitermPluginSource'

import { hideInapplicableSettingsPages } from './hiddenSettingsPages'
import { registerOmniTermSettingsPages } from './registerOmniTermSettingsPages'
import { arrangeSettingsByFeature } from './settingsLayout'
import { defineSimpleSettingsView } from './simpleSettingsPages'

/**
 * OmniTerm's side of the Settings dialog (`file.settings`, opened in-app over the workbench): its
 * own pages (terminal, agents, git, files, backup, artwork, shortcuts, plugins, updates) next to the
 * IDE's, minus the pages for JVM tooling, with the tree arranged by feature and a simple view of it.
 */
export function activateOmniTermSettings(): () => void {
  const disposers = [
    registerOmniTermSettingsPages(),
    hideInapplicableSettingsPages(),
    arrangeSettingsByFeature(),
    defineSimpleSettingsView(),
    registerOmniTermPluginSource(window.omnitermAPI.plugin, OmniTermPluginDetails),
  ]
  return () => disposers.reverse().forEach((dispose) => dispose())
}
