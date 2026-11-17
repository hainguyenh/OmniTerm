import { setSimplePages } from '../../ide/features/settings/model/simpleView'

import { agentSettingsPage, OMNITERM_SETTINGS_PAGES as IDS } from './settingsPageIds'

/**
 * The pages of the simple Settings view: what someone who only runs terminals and agents changes.
 * Everything else (code style, inspections, templates, language tooling, build and debug, MCP,
 * proxy, trust) keeps its default or what was set earlier, and shows again with "Show advanced
 * settings" or through the search.
 */
const SIMPLE_PAGES: ReadonlySet<string> = new Set([
  'appearance',
  IDS.artwork,
  'general',
  'general.language',
  IDS.backup,
  'keymap',
  IDS.shortcuts,
  IDS.editorShortcuts,
  IDS.terminal,
  'tools.sshConfigurations',
  'editor.general',
  'editor.font',
  'editor.colorScheme',
  IDS.files,
  'agents.list',
  IDS.agentSessions,
  IDS.agentQuota,
  'vcs.git',
  IDS.gitUtilities,
  'languages.enabled',
  'plugins',
  IDS.nodePlugins,
  'plugins.extensions',
  IDS.about,
])

const AGENT_PAGE_PREFIX = agentSettingsPage('')

export function isSimpleSettingsPage(id: string): boolean {
  return SIMPLE_PAGES.has(id) || id.startsWith(AGENT_PAGE_PREFIX)
}

/** Gives the Settings dialog its simple view for as long as the returned disposer is not called. */
export function defineSimpleSettingsView(): () => void {
  return setSimplePages(isSimpleSettingsPage)
}
