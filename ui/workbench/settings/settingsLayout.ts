import { setPageLayout } from '../../ide/features/settings/model/pages'
import type { SettingsPageContribution } from '../../ide/workbench/contributions'

import { OMNITERM_SETTINGS_PAGES } from './settingsPageIds'

/**
 * The top-level order of the Settings tree, by feature: Appearance & Behavior, Keymap, Terminal,
 * Editor, Agents, Version Control, Project Structure, Languages & Frameworks, Build/Run/Debug,
 * Plugins, Tools. A group is placed by its base order; its pages keep their relative order.
 */
const GROUP_ORDER: Readonly<Record<string, number>> = {
  'Appearance & Behavior': 0,
  Editor: 20,
  Agents: 30,
  'Languages & Frameworks': 50,
  'Build, Execution, Deployment': 60,
  Tools: 80,
}

/** Top-level pages outside a group, and pages moved into another group. */
const PAGE_LAYOUT: Readonly<Record<string, { group?: string; order: number }>> = {
  keymap: { order: 10 },
  [OMNITERM_SETTINGS_PAGES.terminal]: { order: 15 },
  vcs: { order: 40 },
  projectStructure: { order: 45 },
  plugins: { order: 70 },
  // Alone in a "Security" group otherwise.
  projectTrust: { group: 'Appearance & Behavior', order: 3 },
}

/** Pages up to this order stay within their group's slot (base + order / SPREAD < base + 0.1). */
const SPREAD = 10_000

const nestedUnder = (id: string, ids: ReadonlySet<string>): boolean => {
  for (let i = id.lastIndexOf('.'); i > 0; i = id.lastIndexOf('.', i - 1)) {
    if (ids.has(id.slice(0, i))) return true
  }
  return false
}

/** Where a page goes in the tree; a page nested under another by its id stays with its parent. */
export function layoutSettingsPage(
  page: SettingsPageContribution,
  ids: ReadonlySet<string>,
): SettingsPageContribution {
  if (nestedUnder(page.id, ids)) return page
  const placed = PAGE_LAYOUT[page.id]
  const group = placed?.group ?? page.group
  const order = placed?.order ?? page.order ?? 100
  const base = group === undefined ? undefined : GROUP_ORDER[group]
  const next = base === undefined ? order : base + Math.min(order, SPREAD - 1) / SPREAD
  if (group === page.group && next === page.order) return page
  return { ...page, group, order: next }
}

/** Arranges the Settings tree by feature for as long as the returned disposer is not called. */
export function arrangeSettingsByFeature(): () => void {
  return setPageLayout(layoutSettingsPage)
}
