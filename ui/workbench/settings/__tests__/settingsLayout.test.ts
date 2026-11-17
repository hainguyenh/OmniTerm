import { afterEach, describe, expect, it } from 'vitest'

import { buildPageTree, type PageNode } from '../../../ide/features/settings/model/pages'
import type { SettingsPageContribution } from '../../../ide/workbench/contributions'
import { arrangeSettingsByFeature, layoutSettingsPage } from '../settingsLayout'
import { OMNITERM_SETTINGS_PAGES as IDS } from '../settingsPageIds'

const page = (id: string, title: string, group?: string, order?: number): SettingsPageContribution => ({
  id,
  title,
  group,
  order,
})

const LANGUAGES = 'Languages & Frameworks'
const BUILD = 'Build, Execution, Deployment'
const GENERAL = 'General'
const CODE = 'Code'
const RUN = 'Run'

/** The upstream IDE tree's pages, as they register themselves, plus OmniTerm's. */
const PAGES = [
  page('appearance', 'Appearance', 'Appearance & Behavior', 0),
  page('general', 'System Settings', 'Appearance & Behavior', 1),
  page(IDS.backup, 'Backup & Restore', undefined, 10),
  page(IDS.alwaysAwake, 'Always awake', 'Agents', 490),
  page('projectTrust', 'Project Trust', 'Security'),
  page('keymap', 'Keymap', undefined, 10),
  page(IDS.shortcuts, 'OmniTerm Shortcuts', undefined, 10),
  page('editor.vim', 'Vim', 'Editor', 45),
  page('editor.general', 'General', 'Editor', 20),
  page('editor.codeEditing', 'Code Editing', 'Editor', 21),
  page('editor.inlayHints', 'Inlay Hints', 'Editor', 33),
  page('editor.font', 'Font', 'Editor', 22),
  page('editor.colorScheme', 'Color Scheme', 'Editor', 23),
  page('editor.codeStyle', 'Code Style', 'Editor', 24),
  page('editor.codeStyle.python', 'Python', 'Editor', 100),
  page('editor.liveTemplates', 'Live Templates', 'Editor', 28),
  page('editor.files', 'File Types', 'Editor', 29),
  page(IDS.files, 'Files & Attachments', 'Editor', 28),
  page('editor.todo', 'TODO', 'Editor', 40),
  page('plugins', 'Plugins', undefined, 250),
  page(IDS.nodePlugins, 'Installed', undefined, 10),
  page('vcs', 'Version Control', undefined, 300),
  page(IDS.gitUtilities, 'Git Utilities', undefined, 8.5),
  page('projectStructure', 'Project Structure', undefined, 350),
  page('build.run', 'Run/Debug', BUILD, 363),
  page('build.cmake', 'CMake', BUILD, 357),
  page('build.pythonDebugger', 'Python Debugger', BUILD, 362),
  page('languages.indexing', 'Indexing', LANGUAGES, 399),
  page('languages.servers', 'Language Servers', LANGUAGES, 400),
  page('languages.markdown', 'Markdown', LANGUAGES, 400),
  page('languages.rust', 'Rust', LANGUAGES, 404),
  page('languages.typescript', 'TypeScript', LANGUAGES, 405),
  page('languages.node', 'Node.js', LANGUAGES, 402),
  page('languages.prettier', 'Prettier', LANGUAGES, 403.5),
  page('languages.ruff', 'Ruff', LANGUAGES, 403.7),
  page('python.interpreter', 'Python Interpreter', LANGUAGES, 403),
  page('agents.list', 'Coding Agents', 'Agents', 450),
  page(IDS.agentSessions, 'Agent Sessions', 'Agents', 455),
  page('agents.mcpServer', 'IDE MCP Server', 'Agents', 470),
  page('agents.mcpServers', 'External MCP Servers', 'Agents', 475),
  page(IDS.agentQuota, 'Agent quota', 'Agents', 480),
  page(IDS.terminal, 'Terminal', undefined, 15),
  page('tools.sshConfigurations', 'SSH Configurations', 'Tools', 603),
  page('tools.actionsOnSave', 'Actions on Save', 'Tools', 601),
  page('tools.externalTools', 'External Tools', 'Tools', 602),
  page(IDS.about, 'Updates', undefined, 1000),
]

const titles = (nodes: readonly PageNode[]) => nodes.map((n) => n.title)

/** The children of the node the titles lead to. */
const under = (tree: readonly PageNode[], ...path: string[]): string[] => {
  let nodes = tree
  for (const title of path) {
    const next = nodes.find((n) => n.title === title)
    if (!next) throw new Error(`no "${title}" among ${titles(nodes).join(', ')}`)
    nodes = next.children
  }
  return titles(nodes)
}

let stop: (() => void) | null = null
afterEach(() => {
  stop?.()
  stop = null
})

describe('the Settings tree arranged by feature', () => {
  it('orders the top level by feature under one short name each, ending with Updates', () => {
    stop = arrangeSettingsByFeature()
    expect(titles(buildPageTree(PAGES))).toEqual([
      GENERAL,
      'Keymap',
      'Terminal',
      'Editor',
      'Agents',
      'VCS',
      CODE,
      RUN,
      'Plugins',
      'Updates',
    ])
  })

  it('keeps the order of the pages within a group and nests pages under their parent', () => {
    stop = arrangeSettingsByFeature()
    const tree = buildPageTree(PAGES)
    expect(under(tree, GENERAL)).toEqual(['Appearance', 'System Settings', 'Project Trust'])
    expect(under(tree, GENERAL, 'System Settings')).toEqual(['Backup & Restore', 'Always awake'])
    expect(under(tree, 'VCS')).toEqual(['Git Utilities'])
    expect(under(tree, 'Plugins')).toEqual(['Installed'])
    expect(under(tree, 'Keymap')).toEqual(['OmniTerm Shortcuts', 'Vim'])
    expect(under(tree, 'Terminal')).toEqual(['SSH Configurations'])
    expect(under(tree, RUN)).toEqual(['Run/Debug', 'External Tools'])
  })

  it('groups the editor pages into folders', () => {
    stop = arrangeSettingsByFeature()
    const tree = buildPageTree(PAGES)
    expect(under(tree, 'Editor')).toEqual([
      'General',
      'Code Editing',
      'Look',
      'Style',
      'Templates',
      'Files',
      'TODO',
    ])
    expect(under(tree, 'Editor', 'Code Editing')).toEqual(['Inlay Hints'])
    expect(under(tree, 'Editor', 'Look')).toEqual(['Font', 'Color Scheme'])
    expect(under(tree, 'Editor', 'Style')).toEqual(['Code Style', 'Actions on Save'])
    expect(under(tree, 'Editor', 'Style', 'Code Style')).toEqual(['Python'])
    expect(under(tree, 'Editor', 'Files')).toEqual(['File Types', 'Files & Attachments'])
  })

  it('puts everything of a language under that language', () => {
    stop = arrangeSettingsByFeature()
    const tree = buildPageTree(PAGES)
    expect(under(tree, CODE)).toEqual([
      'Analysis',
      'Python',
      'Rust',
      'TypeScript',
      'C/C++',
      'Markdown',
      'Project Structure',
    ])
    expect(under(tree, CODE, 'Analysis')).toEqual(['Indexing', 'Language Servers'])
    expect(under(tree, CODE, 'Python')).toEqual(['Python Interpreter', 'Ruff', 'Python Debugger'])
    expect(under(tree, CODE, 'TypeScript')).toEqual(['Node.js', 'Prettier'])
    expect(under(tree, CODE, 'C/C++')).toEqual(['CMake'])
  })

  it('keeps the agent pages together, the MCP servers in a folder', () => {
    stop = arrangeSettingsByFeature()
    const tree = buildPageTree(PAGES)
    expect(under(tree, 'Agents')).toEqual(['Coding Agents', 'Agent Sessions', 'MCP', 'Agent quota'])
    expect(under(tree, 'Agents', 'MCP')).toEqual(['IDE MCP Server', 'External MCP Servers'])
  })

  it('leaves a page in its group while the page it goes under is not registered', () => {
    stop = arrangeSettingsByFeature()
    const tree = buildPageTree(PAGES.filter((p) => p.id !== 'languages.typescript' && p.id !== 'general'))
    expect(under(tree, CODE)).toContain('Node.js')
    expect(under(tree, 'Agents')).toContain('Always awake')
  })

  it('leaves the contributions themselves alone', () => {
    const ids = new Set(PAGES.map((p) => p.id))
    const trust = PAGES.find((p) => p.id === 'projectTrust')!
    expect(layoutSettingsPage(trust, ids)).toMatchObject({ id: 'projectTrust', group: GENERAL })
    expect(trust.group).toBe('Security')
    const nested = PAGES.find((p) => p.id === IDS.gitUtilities)!
    expect(layoutSettingsPage(nested, ids)).toBe(nested)
    const vim = PAGES.find((p) => p.id === 'editor.vim')!
    expect(layoutSettingsPage(vim, ids)).toMatchObject({ id: 'editor.vim', parent: 'keymap' })
    expect(vim).not.toHaveProperty('parent')
  })

  it('stops arranging once disposed', () => {
    arrangeSettingsByFeature()()
    expect(titles(buildPageTree(PAGES))).toContain('Security')
  })
})
