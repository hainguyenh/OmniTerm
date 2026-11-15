import { describe, expect, it, vi } from 'vitest'

import { initialTabsState, openTab, paneIds, splitPane, type TabsState } from '../../ide/editor/core/model/tabs'
import type { EditorInput } from '../../ide/workbench/contributions'
import { SESSIONS_KIND } from '../sessionsHostCore'
import type { LegacyLayout, SessionBridgeApi, SessionInfo } from '../sessions/sessionBridge'
import { SESSION_KIND, sessionInput } from '../sessions/sessionInput'
import { createSessionTabsReconciler, type ReconcilerHost } from '../sessions/sessionTabsReconciler'

const session = (id: string, workspaceId: string | null = 'w1'): SessionInfo => ({
  id,
  connId: id,
  name: id,
  connType: 'LOCAL',
  workspaceId,
  status: 'connected',
  busy: false,
  cwd: null,
  hasCommand: false,
})

function fakeHost(overrides: { sessions?: SessionInfo[]; tabs?: TabsState; legacy?: LegacyLayout | null } = {}) {
  let tabs = overrides.tabs ?? initialTabsState()
  const api: SessionBridgeApi = {
    killSession: vi.fn(),
    newSessionLike: vi.fn(),
    reconnect: vi.fn(),
    skipConfirm: () => false,
    setSkipConfirm: vi.fn(),
  }
  const state = {
    sessions: overrides.sessions ?? [],
    restoreSettled: true,
    legacyLayout: (overrides.legacy ?? null) as LegacyLayout | null,
    opening: false,
    project: true,
    loaded: true,
    workspace: 'w1',
    pending: new Set<string>(),
    docked: new Set<string>(),
    now: 1000,
  }
  const removeTab = (paneId: string, tabId: string) => {
    const pane = tabs.panes[paneId]!
    const rest = pane.tabs.filter((tab) => tab.id !== tabId)
    tabs = {
      ...tabs,
      panes: { ...tabs.panes, [paneId]: { ...pane, tabs: rest, active: rest[0]?.id ?? null, mru: rest.map((t) => t.id) } },
    }
  }
  const host = {
    tabs: () => tabs,
    setTabs: (next: TabsState) => {
      tabs = next
    },
    bridge: () => ({ sessions: state.sessions, restoreSettled: state.restoreSettled, legacyLayout: state.legacyLayout, api }),
    consumeLegacyLayout: vi.fn(() => {
      state.legacyLayout = null
    }),
    projectOpening: () => state.opening,
    hasProject: () => state.project,
    workspacesLoaded: () => state.loaded,
    selectedWorkspace: () => state.workspace,
    closeTab: vi.fn(async (paneId: string, tabId: string) => {
      removeTab(paneId, tabId)
      return true
    }),
    closeTabSilently: vi.fn(async (id: string) => {
      for (const pane of Object.values(tabs.panes))
        for (const tab of pane.tabs) if (tab.input.key === sessionInput(id).key) removeTab(pane.id, tab.id)
    }),
    openAndShow: vi.fn(async (input: EditorInput) => {
      tabs = openTab(tabs, tabs.activePane, input).state
    }),
    isClosePending: (id: string) => state.pending.has(id),
    isDocked: (id: string) => state.docked.has(id),
    now: () => state.now,
  } satisfies ReconcilerHost & Record<string, unknown>
  return { host: host as ReconcilerHost & typeof host, state, api, tabsNow: () => tabs }
}

const open = (tabs: TabsState, input: EditorInput) => openTab(tabs, tabs.activePane, input).state

const keys = (tabs: TabsState) =>
  Object.values(tabs.panes).flatMap((pane) => pane.tabs.map((tab) => tab.input.key))

describe('session tabs reconciler', () => {
  it('waits for the restore, an open project and the workspace catalog', async () => {
    const { host, state, tabsNow } = fakeHost({ sessions: [session('a')] })
    const reconciler = createSessionTabsReconciler(host)
    for (const block of ['restoreSettled', 'opening', 'loaded'] as const) {
      state.restoreSettled = block !== 'restoreSettled'
      state.opening = block === 'opening'
      state.loaded = block !== 'loaded'
      await reconciler.run()
      expect(keys(tabsNow())).toEqual([])
    }
    state.restoreSettled = true
    state.opening = false
    state.loaded = true
    await reconciler.run()
    expect(keys(tabsNow())).toEqual(['session:a'])
  })

  it('opens tabs for live sessions in the background, the first time', async () => {
    const { host, tabsNow } = fakeHost({ sessions: [session('a'), session('b')] })
    await createSessionTabsReconciler(host).run()
    expect(keys(tabsNow())).toEqual(['session:a', 'session:b'])
    expect(host.openAndShow).not.toHaveBeenCalled()
  })

  it('shows a session created later', async () => {
    const { host, state, tabsNow } = fakeHost({ sessions: [session('a')] })
    const reconciler = createSessionTabsReconciler(host)
    await reconciler.run()
    state.sessions = [session('a'), session('b')]
    await reconciler.run()
    expect(host.openAndShow).toHaveBeenCalledExactlyOnceWith(sessionInput('b'))
    expect(keys(tabsNow())).toEqual(['session:a', 'session:b'])
  })

  it('turns a split duplicate into a new shell in the same folder, in the split pane', async () => {
    const { host, state, api, tabsNow } = fakeHost({ sessions: [session('a')] })
    const reconciler = createSessionTabsReconciler(host)
    await reconciler.run()
    const split = splitPane(tabsNow(), tabsNow().activePane, 'row')
    host.setTabs(split.state)
    await reconciler.run()
    expect(api.newSessionLike).toHaveBeenCalledExactlyOnceWith('a')
    // The duplicate stays until the new shell exists; waiting does not ask for a second shell.
    await reconciler.run()
    expect(api.newSessionLike).toHaveBeenCalledOnce()
    state.sessions = [session('a'), session('a2')]
    await reconciler.run()
    expect(host.openAndShow).not.toHaveBeenCalled()
    expect(keys(tabsNow())).toEqual(['session:a', 'session:a2'])
    expect(tabsNow().panes[split.paneId]!.tabs.map((tab) => tab.input.key)).toEqual(['session:a2'])
    expect(tabsNow().activePane).toBe(split.paneId)
  })

  it('closes a split duplicate whose new shell never started', async () => {
    const { host, state, tabsNow } = fakeHost({ sessions: [session('a')] })
    const reconciler = createSessionTabsReconciler(host)
    await reconciler.run()
    host.setTabs(splitPane(tabsNow(), tabsNow().activePane, 'row').state)
    await reconciler.run()
    state.now = 1000 + 16_000
    await reconciler.run()
    expect(keys(tabsNow())).toEqual(['session:a'])
  })

  it('does not treat restored tabs as duplicates on its first pass', async () => {
    let tabs = open(initialTabsState(), sessionInput('a'))
    tabs = splitPane(tabs, tabs.activePane, 'row').state
    const { host, api } = fakeHost({ sessions: [session('a')], tabs })
    await createSessionTabsReconciler(host).run()
    expect(api.newSessionLike).not.toHaveBeenCalled()
  })

  it('closes tabs of unknown sessions and invalid inputs silently, never killing', async () => {
    let tabs = open(initialTabsState(), sessionInput('gone'))
    tabs = openTab(tabs, tabs.activePane, { kind: SESSION_KIND, key: 'session:x', data: { sessionId: 'y' } }).state
    const { host, api, tabsNow } = fakeHost({ sessions: [session('a')], tabs })
    await createSessionTabsReconciler(host).run()
    expect(host.closeTabSilently).toHaveBeenCalledWith('gone')
    expect(keys(tabsNow())).toEqual(['session:a'])
    expect(api.killSession).not.toHaveBeenCalled()
  })

  it('keeps the tab of a session whose close can still be undone', async () => {
    const { host, state, tabsNow } = fakeHost({ sessions: [session('a')] })
    const reconciler = createSessionTabsReconciler(host)
    await reconciler.run()
    state.pending.add('a')
    state.sessions = []
    await reconciler.run()
    expect(keys(tabsNow())).toEqual(['session:a'])
  })

  it('removes the old single Sessions tab', async () => {
    let tabs = open(initialTabsState(), { kind: SESSIONS_KIND, key: SESSIONS_KIND })
    tabs = openTab(tabs, tabs.activePane, { kind: 'sessions', key: 'sessions' }).state
    const { host, tabsNow } = fakeHost({ sessions: [session('a')], tabs })
    await createSessionTabsReconciler(host).run()
    expect(keys(tabsNow())).toEqual(['session:a'])
  })

  it('opens only the tabs of the workspace shown; others keep running without a tab', async () => {
    const { host, api, tabsNow } = fakeHost({ sessions: [session('a', 'w1'), session('b', 'w2')] })
    await createSessionTabsReconciler(host).run()
    expect(keys(tabsNow())).toEqual(['session:a'])
    expect(api.killSession).not.toHaveBeenCalled()
  })

  it('closes other workspaces tabs silently only when no project is open', async () => {
    const tabs = open(open(initialTabsState(), sessionInput('a')), sessionInput('b'))
    const withProject = fakeHost({ sessions: [session('a', 'w1'), session('b', 'w2')], tabs })
    await createSessionTabsReconciler(withProject.host).run()
    expect(withProject.host.closeTabSilently).not.toHaveBeenCalled()

    const without = fakeHost({ sessions: [session('a', 'w1'), session('b', 'w2')], tabs })
    without.state.project = false
    await createSessionTabsReconciler(without.host).run()
    expect(without.host.closeTabSilently).toHaveBeenCalledExactlyOnceWith('b')
    expect(without.api.killSession).not.toHaveBeenCalled()
  })

  it('places tabs from the old pane grid once, then forgets it', async () => {
    const legacy: LegacyLayout = { layoutMode: 2, panes: ['b', 'a', null, null, null, null, null, null], focusedPane: 1 }
    const { host, tabsNow } = fakeHost({ sessions: [session('a'), session('b')], legacy })
    await createSessionTabsReconciler(host).run()
    const tabs = tabsNow()
    const [first, second] = paneIds(tabs)
    expect(tabs.panes[first!]!.tabs.map((tab) => tab.input.key)).toEqual(['session:b'])
    expect(tabs.panes[second!]!.tabs.map((tab) => tab.input.key)).toEqual(['session:a'])
    expect(tabs.activePane).toBe(second)
    expect(host.consumeLegacyLayout).toHaveBeenCalled()
  })

  it('sessions without a workspace stay with the workspace they appeared in', async () => {
    const { host, state, tabsNow } = fakeHost({ sessions: [session('home', null)] })
    const reconciler = createSessionTabsReconciler(host)
    await reconciler.run()
    state.workspace = 'w2'
    reconciler.projectSettled()
    state.project = false
    await reconciler.run()
    expect(host.closeTabSilently).toHaveBeenCalledWith('home')
    expect(keys(tabsNow())).toEqual([])
  })

  it('gives a session docked in the Terminal tool window no tab', async () => {
    const { host, state, tabsNow, api } = fakeHost({ sessions: [session('a'), session('docked')] })
    state.docked.add('docked')
    await createSessionTabsReconciler(host).run()
    expect(keys(tabsNow())).toEqual(['session:a'])
    expect(api.killSession).not.toHaveBeenCalled()
  })

  it('closes the tab of a session moved into the Terminal tool window, without killing it', async () => {
    const tabs = open(initialTabsState(), sessionInput('a'))
    const { host, state, tabsNow, api } = fakeHost({ sessions: [session('a')], tabs })
    const reconciler = createSessionTabsReconciler(host)
    await reconciler.run()
    state.docked.add('a')
    await reconciler.run()
    expect(host.closeTabSilently).toHaveBeenCalledExactlyOnceWith('a')
    expect(keys(tabsNow())).toEqual([])
    expect(api.killSession).not.toHaveBeenCalled()
  })
})
