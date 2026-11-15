/** Page ids of OmniTerm's pages; `executeAction('file.settings', id)` opens one. */
export const OMNITERM_SETTINGS_PAGES = {
  terminal: 'tools.omnitermTerminal',
  agentSessions: 'agents.omnitermSessions',
  agentQuota: 'agents.agentQuota',
  alwaysAwake: 'agents.alwaysAwake',
  gitUtilities: 'vcs.omnitermGit',
  files: 'editor.omnitermFiles',
  backup: 'general.backup',
  artwork: 'appearance.artwork',
  shortcuts: 'keymap.omnitermShortcuts',
  editorShortcuts: 'keymap.editorShortcuts',
  nodePlugins: 'plugins.installed',
  about: 'updates',
} as const
