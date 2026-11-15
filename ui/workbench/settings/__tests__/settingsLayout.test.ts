import { afterEach, describe, expect, it } from 'vitest'

import { buildPageTree } from '../../../ide/features/settings/model/pages'
import type { SettingsPageContribution } from '../../../ide/workbench/contributions'
import { arrangeSettingsByFeature, layoutSettingsPage } from '../settingsLayout'
import { OMNITERM_SETTINGS_PAGES as IDS } from '../settingsPageIds'

const page = (id: string, title: string, group?: string, order?: number): SettingsPageContribution => ({
  id,
  title,
  group,
  order,
})

/** The upstream IDE tree's top level, in its own (IntelliJ) order, plus OmniTerm's pages. */
const PAGES = [
  page('appearance', 'Appearance', 'Appearance & Behavior', 0),
  page('general', 'System Settings', 'Appearance & Behavior', 1),
  page(IDS.backup, 'Backup & Restore', undefined, 10),
  page('projectTrust', 'Project Trust', 'Security'),
  page('keymap', 'Keymap', undefined, 10),
  page('editor.font', 'Font', 'Editor', 22),
  page(IDS.files, 'Files & Attachments', 'Editor', 28),
  page('plugins', 'Plugins', undefined, 250),
  page(IDS.nodePlugins, 'Installed', undefined, 10),
  page('vcs', 'Version Control', undefined, 300),
  page(IDS.gitUtilities, 'Git Utilities', undefined, 8.5),
  page('projectStructure', 'Project Structure', undefined, 350),
  page('build.run', 'Run/Debug', 'Build, Execution, Deployment', 363),
  page('languages.rust', 'Rust', 'Languages & Frameworks', 404),
  page('python.interpreter', 'Python Interpreter', 'Languages & Frameworks', 403),
  page('agents.list', 'Coding Agents', 'Agents', 450),
  page(IDS.agentSessions, 'Agent Sessions', 'Agents', 455),
  page(IDS.agentQuota, 'Agent quota', 'Agents', 480),
  page(IDS.terminal, 'Terminal', undefined, 15),
  page('tools.externalTools', 'External Tools', 'Tools', 602),
]

const titles = (nodes: ReturnType<typeof buildPageTree>) => nodes.map((n) => n.title)

let stop: (() => void) | null = null
afterEach(() => {
  stop?.()
  stop = null
})

describe('the Settings tree arranged by feature', () => {
  it('orders the top level by feature', () => {
    stop = arrangeSettingsByFeature()
    expect(titles(buildPageTree(PAGES))).toEqual([
      'Appearance & Behavior',
      'Keymap',
      'Terminal',
      'Editor',
      'Agents',
      'Version Control',
      'Project Structure',
      'Languages & Frameworks',
      'Build, Execution, Deployment',
      'Plugins',
      'Tools',
    ])
  })

  it('keeps the order of the pages within a group and nests pages under their parent', () => {
    stop = arrangeSettingsByFeature()
    const tree = buildPageTree(PAGES)
    const group = (title: string) => tree.find((n) => n.title === title)!
    expect(titles(group('Appearance & Behavior').children)).toEqual(['Appearance', 'System Settings', 'Project Trust'])
    expect(titles(group('Appearance & Behavior').children[1]!.children)).toEqual(['Backup & Restore'])
    expect(titles(group('Agents').children)).toEqual(['Coding Agents', 'Agent Sessions', 'Agent quota'])
    expect(titles(group('Languages & Frameworks').children)).toEqual(['Python Interpreter', 'Rust'])
    expect(titles(group('Version Control').children)).toEqual(['Git Utilities'])
    expect(titles(group('Plugins').children)).toEqual(['Installed'])
  })

  it('leaves the contributions themselves alone', () => {
    const ids = new Set(PAGES.map((p) => p.id))
    const trust = PAGES.find((p) => p.id === 'projectTrust')!
    expect(layoutSettingsPage(trust, ids)).toMatchObject({ id: 'projectTrust', group: 'Appearance & Behavior' })
    expect(trust.group).toBe('Security')
    const nested = PAGES.find((p) => p.id === IDS.gitUtilities)!
    expect(layoutSettingsPage(nested, ids)).toBe(nested)
  })

  it('stops arranging once disposed', () => {
    arrangeSettingsByFeature()()
    expect(titles(buildPageTree(PAGES))).toContain('Security')
  })
})
