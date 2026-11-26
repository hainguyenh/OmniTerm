import { describe, expect, it, vi } from 'vitest'

// The reconciler imports the terminal dock store, which reads its saved state from localStorage when
// it is imported; this suite runs in node, where there is none.
vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
})

import { initialTabsState, openTab, paneIds, setActivePane, type TabsState } from '../../ide/editor/core/model/tabs'
import type { EditorInput } from '../../ide/workbench/contributions'
import { MAX_CONTEXTS, acquire, release } from '../../utils/webglPool'
import { PRESET_IDS, applyPreset, detectPreset } from '../layout/layoutPresets'
import type { SessionBridgeApi, SessionInfo } from '../sessions/sessionBridge'
import { sessionInput } from '../sessions/sessionInput'
import { createSessionTabsReconciler, type ReconcilerHost } from '../sessions/sessionTabsReconciler'

const SESSIONS = 30
const PANES = 8
const SWITCHES = 50

const session = (n: number): SessionInfo => ({
  id: `s${n}`, connId: `s${n}`, name: `s${n}`, connType: 'LOCAL', workspaceId: 'w1', status: 'connected', busy: false, cwd: null, hasCommand: false,
})

function harness() {
  let tabs: TabsState = initialTabsState()
  const sessions = Array.from({ length: SESSIONS }, (_, n) => session(n))
  const api: SessionBridgeApi = { killSession: vi.fn(), newSessionLike: vi.fn(), reconnect: vi.fn(), skipConfirm: () => false, setSkipConfirm: vi.fn() }
  const state = { opening: false }
  const closeTab = vi.fn(async () => true)
  const closeTabSilently = vi.fn(async () => {})
  const host: ReconcilerHost = {
    tabs: () => tabs,
    setTabs: (next) => { tabs = next },
    bridge: () => ({ sessions, restoreSettled: true, legacyLayout: null, api }),
    consumeLegacyLayout: vi.fn(),
    projectOpening: () => state.opening,
    hasProject: () => true,
    workspacesLoaded: () => true,
    selectedWorkspace: () => 'w1',
    closeTab,
    closeTabSilently,
    openAndShow: async (input: EditorInput) => { tabs = openTab(tabs, tabs.activePane, input).state },
    isClosePending: () => false,
    isDocked: () => false,
    now: () => 0,
  }
  return { host, api, state, closeTab, closeTabSilently, tabs: () => tabs, setTabs: (next: TabsState) => { tabs = next } }
}

const tabIds = (tabs: TabsState) => Object.values(tabs.panes).flatMap((pane) => pane.tabs.map((tab) => tab.id)).sort()
const keys = (tabs: TabsState) => Object.values(tabs.panes).flatMap((pane) => pane.tabs.map((tab) => tab.input.key)).sort()

describe('session tabs under load: 8 panes, 30 sessions, 50 project switches', () => {
  it('gives each of 30 sessions one tab, and keeps every tab id through 8 panes and back through every preset', async () => {
    const h = harness()
    await createSessionTabsReconciler(h.host).run()
    expect(keys(h.tabs())).toEqual(Array.from({ length: SESSIONS }, (_, n) => sessionInput(`s${n}`).key).sort())
    const ids = tabIds(h.tabs())

    let tabs = applyPreset(h.tabs(), '4x2')
    expect(paneIds(tabs)).toHaveLength(PANES)
    for (const id of [...PRESET_IDS, '4x2', '1', '3x2', '2x2'] as const) {
      // Move the focus around, as the user does: the active pane must keep its place.
      const order = paneIds(tabs)
      tabs = setActivePane(tabs, order[(order.length * 7) % order.length]!)
      tabs = applyPreset(tabs, id)
      expect(tabIds(tabs)).toEqual(ids)
      expect(detectPreset(tabs.layout)).toBe(id)
    }
    // Nothing was closed or killed by laying the panes out.
    h.setTabs(tabs)
    await createSessionTabsReconciler(h.host).run()
    expect(h.api.killSession).not.toHaveBeenCalled()
    expect(h.closeTabSilently).not.toHaveBeenCalled()
    expect(tabIds(h.tabs())).toEqual(ids)
  })

  it('keeps 30 sessions running and gives each one tab back across 50 project switches', async () => {
    const h = harness()
    const reconciler = createSessionTabsReconciler(h.host)
    await reconciler.run()
    h.setTabs(applyPreset(h.tabs(), '4x2'))
    for (let n = 0; n < SWITCHES; n++) {
      // The editor drops its tabs while the project opens, then restores the next project's.
      h.state.opening = true
      h.setTabs(initialTabsState())
      await reconciler.run()
      expect(keys(h.tabs())).toEqual([])
      h.state.opening = false
      reconciler.projectSettled()
      await reconciler.run()
      expect(keys(h.tabs())).toHaveLength(SESSIONS)
      expect(new Set(keys(h.tabs())).size).toBe(SESSIONS)
    }
    expect(h.api.killSession).not.toHaveBeenCalled()
    expect(h.closeTabSilently).not.toHaveBeenCalled()
  })

  it('holds the WebGL context budget with eight panes of terminals', () => {
    const evicted: number[] = []
    const holders = Array.from({ length: PANES + SESSIONS }, () => ({}))
    holders.forEach((key, n) => acquire(key, () => evicted.push(n)))
    // Only the budget stays alive: every older holder was asked to give its context up.
    expect(evicted).toHaveLength(holders.length - MAX_CONTEXTS)
    holders.forEach((key) => release(key))
  })
})
