import { lazyComponent } from '../../ide/ui'
import { registerSettingsPage } from '../../ide/workbench/contributions'
import { diag } from '../../diag'

import { OMNITERM_SETTINGS_PAGES } from './settingsPageIds'

const pages = () => import('./OmniTermPages')
const shortcuts = () => import('./ShortcutsPage')

/** True when the feature's `info` probe answers yes, i.e. it is switched on in the Plugins dialog. */
async function featureOn(probe: () => Promise<unknown>): Promise<boolean> {
  try {
    return !!(await probe())
  } catch (error) {
    diag.warn('[settings] feature probe failed', error)
    return false
  }
}

/**
 * OmniTerm's own settings pages, each in the group of its feature (`settingsLayout.ts` places the
 * groups): Terminal at the top level; Agents › Agent Sessions, Agent quota and Always awake (the
 * last two only while their built-in feature is switched on, following the Plugins dialog); Version Control › Git Utilities; Editor › Files &
 * Attachments; System Settings › Backup & Restore; Appearance › Artwork; Keymap; Plugins ›
 * Installed; Appearance & Behavior › Updates.
 */
export function registerOmniTermSettingsPages(): () => void {
  const ids = OMNITERM_SETTINGS_PAGES
  const disposers = [
    registerSettingsPage({
      id: ids.terminal,
      title: 'Terminal',
      order: 15,
      keywords: ['shell', 'default shell', 'workspace', 'ctrl+c', 'copy', 'interrupt', 'completion', 'close'],
      component: lazyComponent(() => pages().then((m) => m.TerminalPage)),
    }),
    registerSettingsPage({
      id: ids.agentSessions,
      title: 'Agent Sessions',
      group: 'Agents',
      // After Coding Agents (450).
      order: 455,
      keywords: ['agents', 'renew', 'refresh', 'restart', 'new conversation', 'clear'],
      component: lazyComponent(() => pages().then((m) => m.AgentSessionsPage)),
    }),
    registerSettingsPage({
      id: ids.gitUtilities,
      title: 'Git Utilities',
      order: 8.5,
      keywords: ['git', 'activity bar', 'branch indicator', 'footer'],
      component: lazyComponent(() => pages().then((m) => m.GitUtilitiesPage)),
    }),
    registerSettingsPage({
      id: ids.files,
      title: 'Files & Attachments',
      group: 'Editor',
      order: 28,
      keywords: ['viewer', 'file size', 'excluded file types', 'attachments', 'paste', 'large paste'],
      component: lazyComponent(() => pages().then((m) => m.FilesPage)),
    }),
    registerSettingsPage({
      id: ids.backup,
      title: 'Backup & Restore',
      order: 10,
      keywords: ['backup', 'restore', 'export', 'import', 'data'],
      component: lazyComponent(() => pages().then((m) => m.BackupPage)),
    }),
    registerSettingsPage({
      id: ids.artwork,
      title: 'Artwork',
      order: 20,
      keywords: ['idle', 'loading', 'image', 'custom art', 'pane'],
      component: lazyComponent(() => pages().then((m) => m.ArtworkPage)),
    }),
    registerSettingsPage({
      id: ids.shortcuts,
      title: 'OmniTerm Shortcuts',
      order: 10,
      keywords: ['keyboard', 'bindings', 'hotkeys', 'layout', 'zoom', 'session', 'sidebar'],
      component: lazyComponent(() => shortcuts().then((m) => m.ShortcutsPage)),
    }),
    registerSettingsPage({
      id: ids.editorShortcuts,
      title: 'Editor Shortcuts',
      order: 20,
      keywords: ['viewer', 'editor', 'keyboard', 'bindings', 'fold'],
      component: lazyComponent(() => pages().then((m) => m.EditorShortcutsPage)),
    }),
    registerSettingsPage({
      id: ids.nodePlugins,
      title: 'Installed',
      order: 10,
      keywords: ['plugins', 'omniterm plugins', 'node', 'bundled', 'connection provider', 'enable', 'disable', 'ssh', 'rdp'],
      component: lazyComponent(() => pages().then((m) => m.NodePluginsPage)),
    }),
    registerSettingsPage({
      id: ids.about,
      title: 'Updates',
      group: 'Appearance & Behavior',
      // Right after Appearance (0) and before System Settings (1).
      order: 0.5,
      keywords: ['version', 'update', 'release', 'release notes', 'about', 'license', 'omniterm', 'channel', 'source'],
      component: lazyComponent(() => pages().then((m) => m.AboutPage)),
    }),
  ]

  let live = true
  const resyncs: Array<() => void> = []
  const conditional = (probe: () => Promise<unknown>, register: () => () => void) => {
    let unregister: (() => void) | null = null
    let generation = 0
    const sync = () => {
      const current = ++generation
      void featureOn(probe).then((on) => {
        // Only the latest probe decides, so a slow answer cannot undo a newer toggle.
        if (!live || current !== generation) return
        if (on && !unregister) unregister = register()
        else if (!on && unregister) {
          unregister()
          unregister = null
        }
      })
    }
    resyncs.push(sync)
    disposers.push(() => {
      unregister?.()
      unregister = null
    })
    sync()
  }
  conditional(
    () => window.omnitermAPI.agentQuota.info(),
    () => registerSettingsPage({
      id: ids.agentQuota,
      title: 'Agent quota',
      group: 'Agents',
      order: 480,
      keywords: ['claude', 'codex', 'usage', 'limit', 'footer', 'wake', 'guard', 'loading artwork'],
      component: lazyComponent(() => pages().then((m) => m.AgentQuotaPage)),
    }),
  )
  conditional(
    () => window.omnitermAPI.alwaysAwake.info(),
    () => registerSettingsPage({
      id: ids.alwaysAwake,
      title: 'Always awake',
      group: 'Agents',
      order: 490,
      keywords: ['sleep', 'awake', 'keep awake', 'power', 'caffeine'],
      component: lazyComponent(() => pages().then((m) => m.AlwaysAwakePage)),
    }),
  )

  // Switching a feature in the Plugins dialog (in any window) adds or removes its page at once.
  const stopWatching = window.omnitermAPI.plugin?.onChanged?.(() => resyncs.forEach((sync) => sync()))

  return () => {
    live = false
    stopWatching?.()
    disposers.reverse().forEach((dispose) => dispose())
  }
}
