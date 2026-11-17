import { afterEach, describe, expect, it } from 'vitest'

import { useSettingsDialog } from '../../../ide/features/settings/model/staging'
import { buildPageTree, flatten } from '../../../ide/features/settings/model/pages'
import { useProject } from '../../../ide/platform/project'
import { registerSettingsPage, useSettingsPages } from '../../../ide/workbench/contributions'
import { hideInapplicableSettingsPages, isHiddenSettingsPage, settingsPageFor } from '../hiddenSettingsPages'
import { arrangeSettingsByFeature } from '../settingsLayout'
import { OMNITERM_SETTINGS_PAGES } from '../settingsPageIds'

const families = (entries: Record<string, boolean>) =>
  useProject.setState({ settings: { languages: { families: entries } } as never })

afterEach(() => {
  useSettingsPages.setState({ pages: new Map() })
  useProject.setState({ settings: null })
})

describe('isHiddenSettingsPage', () => {
  it('hides the Java, Gradle, Maven and JVM code style pages', () => {
    for (const id of ['languages.java', 'languages.java.jdk', 'build.gradle', 'build.maven', 'editor.codeStyle.java', 'editor.codeStyle.kotlin', 'editor.colorScheme.java', 'editor.colorScheme.kotlin']) {
      expect(isHiddenSettingsPage(id), id).toBe(true)
    }
  })

  it('hides the Go, PHP and Ruby pages, outside the languages OmniTerm targets', () => {
    for (const id of ['languages.go', 'languages.go.modules', 'languages.go.buildTags', 'languages.php', 'languages.ruby', 'editor.codeStyle.go', 'editor.colorScheme.php', 'editor.codeStyle.ruby']) {
      expect(isHiddenSettingsPage(id), id).toBe(true)
    }
  })

  it('hides pages that drive nothing in OmniTerm or that an OmniTerm page replaces', () => {
    for (const id of ['build.deployment', 'build.deployment.options', 'general.updates']) {
      expect(isHiddenSettingsPage(id), id).toBe(true)
    }
    expect(isHiddenSettingsPage('updates')).toBe(false)
  })

  it('hides the unmounted upstream terminal page', () => {
    expect(isHiddenSettingsPage('tools.terminal')).toBe(true)
  })

  it('keeps both plugin pages: Installed (OmniTerm plugins) and Extensions', () => {
    expect(isHiddenSettingsPage('plugins.extensions')).toBe(false)
    expect(isHiddenSettingsPage('plugins.installed')).toBe(false)
    expect(isHiddenSettingsPage(OMNITERM_SETTINGS_PAGES.agentQuota)).toBe(false)
  })

  it('keeps the pages OmniTerm supports', () => {
    for (const id of ['languages.python', 'languages.rust', 'languages.typescript', 'languages.node', 'editor.codeStyle.csharp', 'editor.codeStyle.rust', 'editor.colorScheme.rust', 'editor.colorScheme.general', 'build.cmake', 'tools.omnitermTerminal', 'appearance']) {
      expect(isHiddenSettingsPage(id), id).toBe(false)
    }
  })
})

describe('hideInapplicableSettingsPages', () => {
  const page = (id: string) => registerSettingsPage({ id, title: id })
  const shown = () => flatten(buildPageTree(useSettingsPages.getState().pages.values())).map((n) => n.key).sort()

  it('removes the pages OmniTerm replaces, already registered or registered later', () => {
    page('tools.terminal')
    page('languages.rust')
    const stop = hideInapplicableSettingsPages()
    expect([...useSettingsPages.getState().pages.keys()]).toEqual(['languages.rust'])
    page('build.deployment')
    page('editor.codeStyle.csharp')
    expect([...useSettingsPages.getState().pages.keys()].sort()).toEqual(['editor.codeStyle.csharp', 'languages.rust'])
    stop()
    page('general.updates')
    expect(useSettingsPages.getState().pages.has('general.updates')).toBe(true)
  })

  it('keeps the pages of a switched-off language registered but out of the tree, until it is switched on', () => {
    const stop = hideInapplicableSettingsPages()
    const stopLayout = arrangeSettingsByFeature()
    page('languages.java')
    page('build.maven')
    page('editor.codeStyle.kotlin')
    page('languages.rust')
    const pageKeys = () => shown().filter((key) => !key.startsWith('group:'))
    expect(useSettingsPages.getState().pages.has('languages.java')).toBe(true)
    expect(pageKeys()).toEqual(['languages.rust'])

    const before = useSettingsPages.getState().pages
    families({ java: true, rust: false })
    // The dialog rebuilds its tree from a new page list.
    expect(useSettingsPages.getState().pages).not.toBe(before)
    expect(pageKeys()).toEqual(['build.maven', 'editor.codeStyle.kotlin', 'languages.java'])
    expect(isHiddenSettingsPage('languages.rust')).toBe(true)
    expect(isHiddenSettingsPage('editor.colorScheme.rust')).toBe(true)
    stopLayout()
    stop()
  })
})

describe('links to hidden pages', () => {
  it('lead to the page that replaced them, or to Languages for a switched-off language', () => {
    expect(settingsPageFor('languages.java')).toBe('languages.enabled')
    expect(settingsPageFor('languages.go.modules')).toBe('languages.enabled')
    expect(settingsPageFor('plugins.extensions')).toBe('plugins.extensions')
    expect(settingsPageFor('tools.terminal')).toBe(OMNITERM_SETTINGS_PAGES.terminal)
    expect(settingsPageFor('general.updates')).toBe(OMNITERM_SETTINGS_PAGES.about)
    expect(settingsPageFor('languages.rust')).toBe('languages.rust')
    families({ java: true })
    expect(settingsPageFor('languages.java')).toBe('languages.java')
  })

  it('open the replacement in the Settings dialog', () => {
    const stop = hideInapplicableSettingsPages()
    useSettingsDialog.setState({ pageId: 'languages.java' })
    expect(useSettingsDialog.getState().pageId).toBe('languages.enabled')
    useSettingsDialog.setState({ pageId: 'plugins.extensions' })
    expect(useSettingsDialog.getState().pageId).toBe('plugins.extensions')
    useSettingsDialog.setState({ pageId: 'editor.font' })
    expect(useSettingsDialog.getState().pageId).toBe('editor.font')
    stop()
    useSettingsDialog.setState({ pageId: 'general.updates' })
    expect(useSettingsDialog.getState().pageId).toBe('general.updates')
  })
})
