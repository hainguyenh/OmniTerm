/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMemoryBackend } from '../../ide/editor/core/backend'
import { EditorController, useTabs } from '../../ide/editor/core/controller'
import { initialTabsState } from '../../ide/editor/core/model/tabs'
import { useProject } from '../../ide/platform/project'
import { registerEditorKind } from '../../ide/workbench/contributions'

/**
 * Pins the behaviour of the bridge editor that session tabs rely on (see workbench/sessions):
 * when `onClose` fires, what a split does to a tab, and what the tab limit evicts. A sync that
 * changes any of it fails here instead of silently killing a terminal.
 */

let controller: EditorController | null = null
const disposers: Array<() => void> = []
const initialSettings = useProject.getState().settings
const project = (root: string) => ({ root }) as unknown as NonNullable<ReturnType<typeof useProject.getState>['project']>
const flush = () => new Promise((resolve) => setTimeout(resolve, 30))
const allTabs = () => Object.values(useTabs.getState().panes).flatMap((pane) => pane.tabs)

function register(kind: string, extra: Partial<Parameters<typeof registerEditorKind>[0]> = {}) {
  const onClose = vi.fn()
  disposers.push(registerEditorKind({ kind, title: (input) => input.key, component: () => null, onClose, ...extra }))
  return onClose
}

function start() {
  controller = new EditorController(createMemoryBackend({}))
  controller.start()
  return controller
}

afterEach(() => {
  controller?.stop()
  controller = null
  while (disposers.length) disposers.pop()?.()
  useTabs.setState(initialTabsState(), true)
  useProject.setState({ project: null, settings: initialSettings, opening: false } as never)
  localStorage.clear()
})

describe('editor contract: closing', () => {
  it('fires onClose once, when the last tab showing an input closes', async () => {
    const onClose = register('contract-close')
    const ctrl = start()
    const input = { kind: 'contract-close', key: 'contract-close:1' }
    await ctrl.openInput(input)
    ctrl.split(useTabs.getState().activePane, 'row')
    const [first] = Object.values(useTabs.getState().panes)
    await ctrl.closeTab(first!.id, first!.tabs[0]!.id)
    expect(onClose).not.toHaveBeenCalled()
    await ctrl.closeInput(input.key)
    expect(onClose).toHaveBeenCalledExactlyOnceWith(input)
  })

  it('does not fire onClose for tabs a project switch resets, and restores restorable ones', async () => {
    const onClose = register('contract-restore', { restorable: true })
    const ctrl = start()
    useProject.setState({ project: project('D:/a') })
    await flush()
    const input = { kind: 'contract-restore', key: 'contract-restore:1', data: { id: '1' } }
    await ctrl.openInput(input)
    useProject.setState({ project: project('D:/b') })
    await flush()
    expect(onClose).not.toHaveBeenCalled()
    expect(allTabs()).toHaveLength(0)
    useProject.setState({ project: project('D:/a') })
    await flush()
    expect(allTabs().map((tab) => tab.input)).toEqual([input])
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('editor contract: splitting', () => {
  it('Split Right duplicates the tab with the same input key', async () => {
    register('contract-split')
    const ctrl = start()
    await ctrl.openInput({ kind: 'contract-split', key: 'contract-split:1' })
    ctrl.split(useTabs.getState().activePane, 'row')
    const tabs = allTabs()
    expect(tabs).toHaveLength(2)
    expect(new Set(tabs.map((tab) => tab.input.key)).size).toBe(1)
    expect(new Set(tabs.map((tab) => tab.id)).size).toBe(2)
  })

  it('Split Right of a splitOpensEmpty kind opens an empty, active pane and keeps the tab single', async () => {
    register('contract-split-empty', { splitOpensEmpty: true })
    const ctrl = start()
    await ctrl.openInput({ kind: 'contract-split-empty', key: 'contract-split-empty:1' })
    const source = useTabs.getState().activePane
    ctrl.split(source, 'row')
    const state = useTabs.getState()
    expect(Object.keys(state.panes)).toHaveLength(2)
    expect(state.activePane).not.toBe(source)
    expect(state.panes[state.activePane]?.tabs).toEqual([])
    expect(allTabs().map((tab) => tab.input.key)).toEqual(['contract-split-empty:1'])
  })
})

describe('editor contract: tab limit', () => {
  const limit = (tabLimit: number) => useProject.setState({ settings: { editor: { tabs: { tabLimit } } } } as never)

  it('evicts the least recently used tab and fires onClose for it', async () => {
    const onClose = register('contract-evict')
    const ctrl = start()
    limit(2)
    for (const n of [1, 2, 3]) await ctrl.openInput({ kind: 'contract-evict', key: `contract-evict:${n}` })
    await flush()
    expect(allTabs().map((tab) => tab.input.key)).toEqual(['contract-evict:2', 'contract-evict:3'])
    expect(onClose).toHaveBeenCalledExactlyOnceWith({ kind: 'contract-evict', key: 'contract-evict:1' })
  })

  it('never evicts tabs of a kind that is exempt from the limit', async () => {
    const onClose = register('contract-exempt', { exemptFromTabLimit: true })
    const ctrl = start()
    limit(2)
    for (const n of [1, 2, 3, 4]) await ctrl.openInput({ kind: 'contract-exempt', key: `contract-exempt:${n}` })
    await flush()
    expect(allTabs()).toHaveLength(4)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('editor contract: confirmClose', () => {
  it('asks before the last tab of an input closes, and a refusal keeps every tab', async () => {
    const confirmClose = vi.fn(async () => false)
    const onClose = register('contract-confirm', { confirmClose })
    const ctrl = start()
    const input = { kind: 'contract-confirm', key: 'contract-confirm:1' }
    await ctrl.openInput(input)
    expect(await ctrl.closeInput(input.key)).toBe(false)
    expect(confirmClose).toHaveBeenCalledExactlyOnceWith([input])
    expect(allTabs()).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()
    confirmClose.mockResolvedValue(true)
    expect(await ctrl.closeInput(input.key)).toBe(true)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not ask while another tab still shows the input; asks on eviction unless exempt', async () => {
    const confirmClose = vi.fn(async () => true)
    register('contract-confirm2', { confirmClose, exemptFromTabLimit: true })
    const ctrl = start()
    await ctrl.openInput({ kind: 'contract-confirm2', key: 'contract-confirm2:1' })
    ctrl.split(useTabs.getState().activePane, 'row')
    const [first] = Object.values(useTabs.getState().panes)
    await ctrl.closeTab(first!.id, first!.tabs[0]!.id)
    expect(confirmClose).not.toHaveBeenCalled()
    useProject.setState({ settings: { editor: { tabs: { tabLimit: 1 } } } } as never)
    for (const n of [2, 3]) await ctrl.openInput({ kind: 'contract-confirm2', key: `contract-confirm2:${n}` })
    await flush()
    expect(confirmClose).not.toHaveBeenCalled()
  })
})

describe('editor contract: activation focus', () => {
  // Regression: activating a custom editor's tab (a session's terminal) focused nothing, so focus
  // stayed on the clicked tab and typing never reached the terminal until it was clicked into.
  it('focuses the content of an activated custom editor tab, unless asked not to', async () => {
    register('contract-focus')
    const ctrl = start()
    await ctrl.openInput({ kind: 'contract-focus', key: 'contract-focus:1' })
    await ctrl.openInput({ kind: 'contract-focus', key: 'contract-focus:2' })
    const paneId = useTabs.getState().activePane
    const [first] = useTabs.getState().panes[paneId]!.tabs
    const pane = document.createElement('div')
    pane.dataset.paneId = paneId
    const box = document.createElement('div')
    box.tabIndex = -1
    box.dataset.editorFocus = ''
    const tabButton = document.createElement('button')
    pane.append(tabButton, box)
    document.body.appendChild(pane)
    try {
      tabButton.focus()
      ctrl.activate(paneId, first!.id, false)
      await flush()
      expect(document.activeElement).toBe(tabButton)
      ctrl.activate(paneId, first!.id)
      await flush()
      expect(document.activeElement).toBe(box)
    } finally {
      pane.remove()
    }
  })
})
