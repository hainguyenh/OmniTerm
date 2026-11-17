import { setPageLayout, type PlacedPage } from '../../ide/features/settings/model/pages'
import type { SettingsPageContribution } from '../../ide/workbench/contributions'

import { isOffLanguagePage } from './hiddenSettingsPages'
import { OMNITERM_SETTINGS_PAGES } from './settingsPageIds'

const GENERAL = 'General'
const EDITOR = 'Editor'
const AGENTS = 'Agents'
const CODE = 'Code'
const RUN = 'Run'

/** One short name per top-level group, in place of the IDE's own (the tree shows it with an icon). */
const GROUP_NAMES: Readonly<Record<string, string>> = {
  'Appearance & Behavior': GENERAL,
  'Languages & Frameworks': CODE,
  'Build, Execution, Deployment': RUN,
}

/** Top-level pages whose title is shortened the same way. */
const PAGE_TITLES: Readonly<Record<string, string>> = {
  vcs: 'VCS',
}

/**
 * The top-level order of the Settings tree, by feature: General, Keymap, Terminal, Editor, Agents,
 * VCS, Code, Run, Plugins, then Updates as the last row. A group is placed by its base order; its
 * pages keep their relative order. Tools is only left for pages a plugin contributes to it.
 */
const GROUP_ORDER: Readonly<Record<string, number>> = {
  [GENERAL]: 0,
  [EDITOR]: 20,
  [AGENTS]: 30,
  [CODE]: 50,
  [RUN]: 60,
  Tools: 80,
}

interface Placement {
  /** The group the page moves to; its own when absent. */
  group?: string
  /** Folders below the group. */
  folders?: readonly string[]
  /** The page it goes under, while that page is registered; `group` applies otherwise. */
  parent?: string
  /** Its order among its siblings; its own when absent. */
  order?: number
}

const LOOK = ['Look']
const STYLE = ['Style']
const TEMPLATES = ['Templates']
const FILES = ['Files']
const MCP = ['MCP']
const ANALYSIS = ['Analysis']
const PYTHON = ['Python']

/**
 * Where each page goes when it is not where it registered itself. Everything a language needs
 * (its SDK, formatters, debugger, build tool) sits under that language, so a language is one node.
 */
const PAGE_LAYOUT: Readonly<Record<string, Placement>> = {
  keymap: { order: 10 },
  [OMNITERM_SETTINGS_PAGES.terminal]: { order: 15 },
  vcs: { order: 40 },
  plugins: { order: 70 },
  [OMNITERM_SETTINGS_PAGES.about]: { order: 90 },

  // Alone in a "Security" group otherwise.
  projectTrust: { group: GENERAL, order: 3 },
  // Keeps the computer awake: a system setting, not an agent's.
  [OMNITERM_SETTINGS_PAGES.alwaysAwake]: { parent: 'general', order: 20 },

  'editor.vim': { parent: 'keymap', order: 30 },
  'tools.sshConfigurations': { parent: OMNITERM_SETTINGS_PAGES.terminal, order: 10 },

  'editor.inlayHints': { parent: 'editor.codeEditing', order: 10 },
  'editor.font': { folders: LOOK, order: 22 },
  'editor.colorScheme': { folders: LOOK, order: 23 },
  'editor.codeStyle': { folders: STYLE, order: 24 },
  'editor.inspections': { folders: STYLE, order: 25 },
  'tools.actionsOnSave': { group: EDITOR, folders: STYLE, order: 25.3 },
  'editor.naturalLanguages': { folders: STYLE, order: 25.6 },
  'editor.fileTemplates': { folders: TEMPLATES, order: 26 },
  'editor.liveTemplates': { folders: TEMPLATES, order: 26.5 },
  'editor.files': { folders: FILES, order: 27 },
  'editor.fileEncodings': { folders: FILES, order: 27.3 },
  [OMNITERM_SETTINGS_PAGES.files]: { folders: FILES, order: 27.6 },

  'agents.mcpServer': { folders: MCP },
  'agents.mcpServers': { folders: MCP },

  'languages.enabled': { order: 370 },
  'languages.indexing': { folders: ANALYSIS, order: 380 },
  'languages.servers': { folders: ANALYSIS, order: 381 },
  'languages.node': { parent: 'languages.typescript', order: 1 },
  'languages.prettier': { parent: 'languages.typescript', order: 2 },
  'languages.oxfmt': { parent: 'languages.typescript', order: 3 },
  'python.interpreter': { folders: PYTHON, order: 403 },
  'languages.ruff': { folders: PYTHON, order: 403.1 },
  'build.pythonDebugger': { group: CODE, folders: PYTHON, order: 403.2 },
  'build.cmake': { group: CODE, folders: ['C/C++'], order: 406 },
  'languages.markdown': { order: 410 },
  // Hidden today (`hiddenSettingsPages.ts`); they belong to Java once that language is shown.
  'languages.kotlin': { parent: 'languages.java', order: 1 },
  'build.gradle': { parent: 'languages.java', order: 2 },
  'build.maven': { parent: 'languages.java', order: 3 },

  // Modules, libraries and SDKs of the project: with the languages it configures, after them.
  projectStructure: { group: CODE, order: 420 },

  'tools.externalTools': { group: RUN, order: 365 },
}

/** Pages up to this order stay within their group's slot (base + order / SPREAD < base + 0.1). */
const SPREAD = 10_000

const nestedUnder = (id: string, ids: ReadonlySet<string>): boolean => {
  for (let i = id.lastIndexOf('.'); i > 0; i = id.lastIndexOf('.', i - 1)) {
    if (ids.has(id.slice(0, i))) return true
  }
  return false
}

/**
 * Where a page goes in the tree; a page nested under another by its id stays with its parent. A
 * page of a language family that is switched off (Code › Languages) is left out.
 */
export function layoutSettingsPage(page: SettingsPageContribution, ids: ReadonlySet<string>): PlacedPage | null {
  if (isOffLanguagePage(page.id)) return null
  const placed = PAGE_LAYOUT[page.id]
  if (placed?.parent !== undefined && ids.has(placed.parent)) {
    return { ...page, parent: placed.parent, order: placed.order ?? page.order }
  }
  if (nestedUnder(page.id, ids)) return page
  const own = placed?.group ?? page.group
  const group = own === undefined ? undefined : GROUP_NAMES[own] ?? own
  const order = placed?.order ?? page.order ?? 100
  const base = group === undefined ? undefined : GROUP_ORDER[group]
  const next = base === undefined ? order : base + Math.min(order, SPREAD - 1) / SPREAD
  const title = PAGE_TITLES[page.id] ?? page.title
  if (group === page.group && next === page.order && title === page.title && !placed?.folders) return page
  return { ...page, title, group, order: next, folders: placed?.folders }
}

/** Arranges the Settings tree by feature for as long as the returned disposer is not called. */
export function arrangeSettingsByFeature(): () => void {
  return setPageLayout(layoutSettingsPage)
}
