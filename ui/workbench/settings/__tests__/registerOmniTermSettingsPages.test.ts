/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsPages } from '../../../ide/workbench/contributions'
import { registerOmniTermSettingsPages } from '../registerOmniTermSettingsPages'
import { OMNITERM_SETTINGS_PAGES as IDS } from '../settingsPageIds'

const changed: Array<() => void> = []

function stubApi(quota: boolean, awake: boolean | (() => boolean)) {
  changed.length = 0
  vi.stubGlobal('omnitermAPI', {
    agentQuota: { info: () => Promise.resolve(quota) },
    alwaysAwake: { info: () => (typeof awake === 'function' ? Promise.resolve(awake()) : awake ? Promise.resolve(true) : Promise.reject(new Error('no command'))) },
    plugin: { onChanged: (fn: () => void) => { changed.push(fn); return () => {} } },
  })
  ;(window as unknown as { omnitermAPI: unknown }).omnitermAPI = (globalThis as unknown as { omnitermAPI: unknown }).omnitermAPI
}

const pages = () => useSettingsPages.getState().pages

beforeEach(() => useSettingsPages.setState({ pages: new Map() }))
afterEach(() => vi.unstubAllGlobals())

describe('registerOmniTermSettingsPages', () => {
  it('registers the always-present pages in the group of their feature', async () => {
    stubApi(false, false)
    const stop = registerOmniTermSettingsPages()
    await new Promise((r) => setTimeout(r, 0))
    expect(pages().get(IDS.terminal)?.title).toBe('Terminal')
    expect(pages().get(IDS.terminal)?.group).toBeUndefined()
    expect(pages().get(IDS.agentSessions)).toMatchObject({ title: 'Agent Sessions', group: 'Agents' })
    expect(pages().get(IDS.gitUtilities)?.id.startsWith('vcs.')).toBe(true)
    expect(pages().get(IDS.files)).toMatchObject({ title: 'Files & Attachments', group: 'Editor' })
    expect(pages().get(IDS.backup)?.id.startsWith('general.')).toBe(true)
    expect(pages().get(IDS.artwork)?.id.startsWith('appearance.')).toBe(true)
    expect(pages().get(IDS.shortcuts)?.id.startsWith('keymap.')).toBe(true)
    expect(pages().get(IDS.editorShortcuts)?.id.startsWith('keymap.')).toBe(true)
    expect(pages().get(IDS.nodePlugins)).toMatchObject({ id: 'plugins.installed', title: 'Installed' })
    expect(pages().get(IDS.about)).toMatchObject({ title: 'Updates', group: 'Appearance & Behavior' })
    for (const page of pages().values()) expect(page.component).toBeTypeOf('function')
    expect(pages().has(IDS.agentQuota)).toBe(false)
    expect(pages().has(IDS.alwaysAwake)).toBe(false)
    stop()
    expect(pages().size).toBe(0)
  })

  it('adds Agent quota and Always awake to the Agents group while their features are on', async () => {
    stubApi(true, true)
    const stop = registerOmniTermSettingsPages()
    await new Promise((r) => setTimeout(r, 0))
    expect(pages().get(IDS.agentQuota)).toMatchObject({ title: 'Agent quota', group: 'Agents' })
    expect(pages().get(IDS.alwaysAwake)).toMatchObject({ title: 'Always awake', group: 'Agents' })
    expect(IDS.agentQuota.startsWith(`${IDS.nodePlugins}.`)).toBe(false)
    stop()
    expect(pages().size).toBe(0)
  })

  it('adds and removes a page as its feature is switched in the Plugins dialog', async () => {
    let awake = true
    stubApi(false, () => awake)
    const stop = registerOmniTermSettingsPages()
    await new Promise((r) => setTimeout(r, 0))
    expect(pages().has(IDS.alwaysAwake)).toBe(true)
    awake = false
    changed.forEach((fn) => fn())
    await new Promise((r) => setTimeout(r, 0))
    expect(pages().has(IDS.alwaysAwake)).toBe(false)
    awake = true
    changed.forEach((fn) => fn())
    await new Promise((r) => setTimeout(r, 0))
    expect(pages().has(IDS.alwaysAwake)).toBe(true)
    stop()
    expect(pages().size).toBe(0)
  })

  it('does not register a plugin page after the window was torn down', async () => {
    stubApi(true, true)
    registerOmniTermSettingsPages()()
    await new Promise((r) => setTimeout(r, 0))
    expect(pages().size).toBe(0)
  })
})
