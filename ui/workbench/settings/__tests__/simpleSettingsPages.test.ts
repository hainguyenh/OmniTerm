import { afterEach, describe, expect, it } from 'vitest'

import { buildPageTree, flatten } from '../../../ide/features/settings/model/pages'
import { hasSimpleView, simplePageTree } from '../../../ide/features/settings/model/simpleView'
import type { SettingsPageContribution } from '../../../ide/workbench/contributions'
import { agentSettingsPage, OMNITERM_SETTINGS_PAGES as IDS } from '../settingsPageIds'
import { defineSimpleSettingsView, isSimpleSettingsPage } from '../simpleSettingsPages'

const page = (id: string, title: string, group?: string): SettingsPageContribution => ({ id, title, group })

const PAGES = [
  page('appearance', 'Appearance', 'General'),
  page('general', 'System Settings', 'General'),
  page('general.httpProxy', 'HTTP Proxy'),
  page(IDS.backup, 'Backup & Restore'),
  page('editor.font', 'Font', 'Editor'),
  page('editor.inspections', 'Inspections', 'Editor'),
  page('vcs', 'VCS'),
  page('vcs.git', 'Git'),
  page('vcs.shelf', 'Shelf'),
  page(agentSettingsPage('claude'), 'Claude Code', 'Agents'),
  page('agents.mcpServers', 'External MCP Servers', 'Agents'),
  page('build.debugger', 'Debugger', 'Run'),
]

const keys = (keep?: string) => flatten(simplePageTree(buildPageTree(PAGES), keep)).map((n) => n.key)

let stop: (() => void) | null = null
afterEach(() => {
  stop?.()
  stop = null
})

describe('the simple Settings view', () => {
  it('lists the everyday pages and the parents leading to them, nothing advanced', () => {
    stop = defineSimpleSettingsView()
    expect(hasSimpleView()).toBe(true)
    // Unarranged, the groups sort by title.
    expect(keys()).toEqual([
      'group:Agents',
      agentSettingsPage('claude'),
      'group:Editor',
      'editor.font',
      'group:General',
      'appearance',
      'general',
      IDS.backup,
      // Kept only as the parent of Git.
      'vcs',
      'vcs.git',
    ])
  })

  it('keeps the page being shown even when it is advanced', () => {
    stop = defineSimpleSettingsView()
    expect(keys('build.debugger')).toEqual(expect.arrayContaining(['group:Run', 'build.debugger']))
    expect(keys('build.debugger')).not.toContain('editor.inspections')
  })

  it('counts every agent page as simple, and no language tooling', () => {
    expect(isSimpleSettingsPage(agentSettingsPage('codex'))).toBe(true)
    expect(isSimpleSettingsPage('editor.codeStyle.python')).toBe(false)
    expect(isSimpleSettingsPage('projectStructure')).toBe(false)
  })

  it('shows the whole tree while no simple view is defined', () => {
    expect(hasSimpleView()).toBe(false)
    expect(keys()).toHaveLength(flatten(buildPageTree(PAGES)).length)
  })
})
