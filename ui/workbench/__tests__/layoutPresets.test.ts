import { describe, expect, it } from 'vitest'

import { initialTabsState, openTab, paneIds, setActivePane, type TabsState } from '../../ide/editor/core/model/tabs'
import {
  PRESETS,
  applyPreset,
  detectPreset,
  presetForPaneCount,
  restorePanes,
  snapshotPanes,
  type PresetId,
} from '../layout/layoutPresets'
import { sessionInput } from '../sessions/sessionInput'

function withSessions(count: number): TabsState {
  let state = initialTabsState()
  for (let i = 0; i < count; i++) state = openTab(state, state.activePane, sessionInput(`s${i}`), { preview: false }).state
  return state
}

const tabIds = (state: TabsState) => Object.values(state.panes).flatMap((pane) => pane.tabs.map((tab) => tab.id)).sort()
const keysOf = (state: TabsState) => paneIds(state).map((id) => state.panes[id]!.tabs.map((tab) => tab.input.key))

describe('layout presets', () => {
  it.each(PRESETS)('builds the $id template with $panes panes', ({ id, panes }) => {
    const next = applyPreset(withSessions(3), id)
    expect(paneIds(next)).toHaveLength(panes)
    expect(detectPreset(next.layout)).toBe(id)
    expect(Object.keys(next.panes).sort()).toEqual([...paneIds(next)].sort())
  })

  it('maps a pane count to the preset that holds it', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(presetForPaneCount)).toEqual(['1', '2', '1+2', '2x2', '3x2', '3x2', '4x2', '4x2'])
  })

  it('keeps every tab id and the active tab while growing, lending new panes non-active tabs', () => {
    const before = withSessions(4)
    const active = before.panes[before.activePane]!.active
    const next = applyPreset(before, '2x2')
    expect(tabIds(next)).toEqual(tabIds(before))
    expect(next.activePane).toBe(before.activePane)
    expect(next.panes[next.activePane]!.active).toBe(active)
    expect(paneIds(next).every((id) => next.panes[id]!.tabs.length === 1)).toBe(true)
  })

  it('leaves new panes empty when there is nothing to lend', () => {
    const next = applyPreset(withSessions(1), '2')
    expect(keysOf(next).map((keys) => keys.length).sort()).toEqual([0, 1])
  })

  it('shrinks by moving the dropped panes tabs onto the last kept pane and keeps its active tab', () => {
    const grown = applyPreset(withSessions(4), '2x2')
    const before = tabIds(grown)
    const order = paneIds(grown)
    const lastKept = order[1]!
    const activeOfLast = grown.panes[lastKept]!.active
    const shrunk = applyPreset(setActivePane(grown, order[0]!), '2')
    expect(tabIds(shrunk)).toEqual(before)
    expect(paneIds(shrunk)).toEqual([order[0], order[1]])
    expect(shrunk.panes[lastKept]!.tabs).toHaveLength(3)
    expect(shrunk.panes[lastKept]!.active).toBe(activeOfLast)
    expect(shrunk.activePane).toBe(order[0])
  })

  it('lets an active pane beyond the new count take the last slot', () => {
    const grown = applyPreset(withSessions(4), '2x2')
    const order = paneIds(grown)
    const shrunk = applyPreset(setActivePane(grown, order[3]!), '2')
    expect(paneIds(shrunk)).toEqual([order[0], order[3]])
    expect(shrunk.activePane).toBe(order[3])
    expect(tabIds(shrunk)).toEqual(tabIds(grown))
  })

  it('is a no-op when the layout already is the preset', () => {
    const next = applyPreset(withSessions(2), '2')
    expect(applyPreset(next, '2')).toBe(next)
  })

  it('detects two stacked panes as the 2 rows preset, and a hand-made split as custom', () => {
    const next = applyPreset(withSessions(3), '1+2')
    const children = next.layout.kind === 'split' ? next.layout.children : []
    expect(detectPreset({ kind: 'split', id: 'x', dir: 'column', children: children.slice(0, 1).concat({ kind: 'pane', paneId: 'extra' }) })).toBe('2h')
    expect(detectPreset({ kind: 'split', id: 'x', dir: 'column', children })).toBe('custom')
  })

  it('stacks two panes for 2 rows without losing a tab', () => {
    const state = withSessions(3)
    const next = applyPreset(state, '2h')
    expect(detectPreset(next.layout)).toBe('2h')
    expect(tabIds(next)).toEqual(tabIds(state))
  })

  it('round-trips through every preset without losing a tab', () => {
    let state = withSessions(7)
    const ids = tabIds(state)
    for (const id of ['4x2', '1', '3x2', '1+2', '2x2', '2', '1'] as PresetId[]) {
      state = applyPreset(state, id)
      expect(tabIds(state)).toEqual(ids)
    }
  })
})

describe('maximize snapshot', () => {
  it('restores each tab to the pane it had, with the same tab ids', () => {
    const grown = applyPreset(withSessions(4), '2x2')
    const before = keysOf(grown)
    const snapshot = snapshotPanes(grown, '2x2')
    const maximized = applyPreset(grown, '1')
    expect(paneIds(maximized)).toHaveLength(1)
    const restored = restorePanes(maximized, snapshot)
    expect(detectPreset(restored.layout)).toBe('2x2')
    expect(keysOf(restored)).toEqual(before)
    expect(tabIds(restored)).toEqual(tabIds(grown))
  })

  it('keeps a tab opened while maximized', () => {
    const grown = applyPreset(withSessions(3), '2')
    const snapshot = snapshotPanes(grown, '2')
    const maximized = openTab(applyPreset(grown, '1'), grown.activePane, sessionInput('late'), { preview: false }).state
    const restored = restorePanes(maximized, snapshot)
    expect(keysOf(restored).flat()).toContain('session:late')
  })
})
