/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type TabState = {
  layout: unknown
  activePane: string
  panes: Record<string, { id: string; active: string | null; tabs: Array<{ id: string; input: unknown }> }>
}

const h = vi.hoisted(() => ({
  tabState: null as unknown,
  setState: vi.fn(),
  order: [] as string[],
  neighbour: null as string | null,
  applyPreset: vi.fn(),
  maximized: false,
  maximizedListeners: new Set<() => void>(),
  restoreMaximized: vi.fn(),
  maximizeActivePane: vi.fn(),
  restorer: vi.fn(),
  stopRestorer: vi.fn(),
  action: null as null | { run: () => void },
  stopAction: vi.fn(),
  stopTitle: vi.fn(),
  newSessionLike: vi.fn(),
  bridgeApi: null as unknown,
  zoomOverrides: {} as Record<string, number>,
  setZoomOverride: vi.fn(),
}))

vi.mock('../../../ide/editor/core/controller', () => {
  const useTabs = (select: (s: unknown) => unknown) => select(h.tabState)
  useTabs.getState = () => h.tabState
  useTabs.setState = (...args: unknown[]) => h.setState(...args)
  return { useTabs }
})
vi.mock('../../../ide/editor/core/model/tabs', () => ({
  neighbourPane: () => h.neighbour,
  paneIds: () => h.order,
  setActivePane: (_s: unknown, id: string) => ({ activePane: id }),
}))
vi.mock('../../../ide/platform/actions', () => ({
  registerAction: (action: { run: () => void }) => {
    h.action = action
    return h.stopAction
  },
}))
vi.mock('../../sessions/sessionBridge', () => ({
  useSessionBridge: { getState: () => ({ api: h.bridgeApi }) },
}))
vi.mock('../../sessions/sessionInput', () => ({
  parseSessionInput: (input: unknown) => (input as { session?: string } | undefined)?.session ?? null,
}))
vi.mock('../layoutPresetStore', () => ({
  applyEditorPreset: (...args: unknown[]) => h.applyPreset(...args),
  isMaximized: () => h.maximized,
  maximizeActivePane: () => h.maximizeActivePane(),
  restoreMaximized: () => h.restoreMaximized(),
  startPresetRestorer: () => {
    h.restorer()
    return h.stopRestorer
  },
  subscribeMaximized: (cb: () => void) => {
    h.maximizedListeners.add(cb)
    return () => h.maximizedListeners.delete(cb)
  },
}))
vi.mock('../paneTitleActions', () => ({
  TOGGLE_MAXIMIZE_PANE: 'toggle-maximize',
  registerPaneTitleActions: () => h.stopTitle,
}))
vi.mock('../layoutPresets', () => ({
  detectPreset: () => 'custom',
  presetForPaneCount: (n: number) => `preset-${n}`,
}))
vi.mock('../sessionZoom', () => ({
  effectiveZoom: (key: string, _area: unknown, overrides: Record<string, number>) => overrides[key] ?? 1,
  setZoomOverride: (...args: unknown[]) => h.setZoomOverride(...args),
  stepZoom: (zoom: number, dir: number) => zoom + dir,
  useSessionZoom: (select: (s: { overrides: Record<string, number> }) => unknown) => select({ overrides: h.zoomOverrides }),
  zoomKey: (preset: string, count: number) => `${preset}:${count}`,
}))
vi.mock('../useEditorAreaSize', () => ({ useEditorAreaSize: () => ({ width: 800, height: 600 }) }))

import {
  openSessionInNextPane,
  useCurrentPreset,
  useLayoutPresetEffects,
  useMaximized,
  useSessionZoomModel,
  useTerminalZoom,
} from '../useLayoutPreset'

function tabs(over: Partial<TabState> = {}): TabState {
  return {
    layout: {},
    activePane: 'p1',
    panes: {
      p1: { id: 'p1', active: 't1', tabs: [{ id: 't1', input: { session: 's1' } }] },
      p2: { id: 'p2', active: null, tabs: [{ id: 't2', input: { session: 's2' } }] },
    },
    ...over,
  }
}

describe('useLayoutPreset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.tabState = tabs()
    h.order = ['p1', 'p2']
    h.neighbour = 'p2'
    h.maximized = false
    h.maximizedListeners.clear()
    h.zoomOverrides = {}
    h.bridgeApi = { newSessionLike: h.newSessionLike }
    h.applyPreset.mockReturnValue(true)
  })
  afterEach(cleanup)

  it('reads the current preset and the maximized flag', () => {
    expect(renderHook(() => useCurrentPreset()).result.current).toBe('custom')
    const { result } = renderHook(() => useMaximized())
    expect(result.current).toBe(false)
    h.maximized = true
    act(() => h.maximizedListeners.forEach((listener) => listener()))
    expect(result.current).toBe(true)
  })

  it('derives the zoom model from the layout and the overrides', () => {
    h.order = ['a', 'b', 'c', 'd']
    const { result } = renderHook(() => useSessionZoomModel())
    expect(result.current).toMatchObject({ key: 'custom:4', available: true, zoom: 1, manual: false })
    act(() => result.current.step(1))
    expect(h.setZoomOverride).toHaveBeenCalledWith('custom:4', 2)
    act(() => result.current.auto())
    expect(h.setZoomOverride).toHaveBeenCalledWith('custom:4', null)
  })

  it('has no zoom in a small layout and reports a manual override', () => {
    h.order = ['a', 'b']
    h.zoomOverrides = { 'custom:2': 1.5 }
    const { result } = renderHook(() => useSessionZoomModel())
    expect(result.current).toMatchObject({ available: false, manual: true, zoom: 1.5 })
    expect(renderHook(() => useTerminalZoom()).result.current).toBe(1.5)
  })

  describe('openSessionInNextPane', () => {
    it('opens a sibling of the active tab in the next pane', () => {
      expect(openSessionInNextPane()).toBe(true)
      expect(h.setState).toHaveBeenCalledWith({ activePane: 'p2' }, true)
      expect(h.newSessionLike).toHaveBeenCalledWith('s1')
    })

    it('falls back to any session when the active tab is not one', () => {
      h.tabState = tabs({ panes: {
        p1: { id: 'p1', active: 't1', tabs: [{ id: 't1', input: { file: 'a' } }] },
        p2: { id: 'p2', active: null, tabs: [{ id: 't2', input: { session: 's2' } }] },
      } })
      expect(openSessionInNextPane()).toBe(true)
      expect(h.newSessionLike).toHaveBeenCalledWith('s2')
    })

    it('does nothing without a session or a bridge', () => {
      h.bridgeApi = null
      expect(openSessionInNextPane()).toBe(false)
      h.bridgeApi = { newSessionLike: h.newSessionLike }
      h.tabState = tabs({ panes: { p1: { id: 'p1', active: null, tabs: [] } } })
      expect(openSessionInNextPane()).toBe(false)
    })

    it('splits a single pane first and gives up when it cannot', () => {
      h.order = ['p1']
      h.applyPreset.mockReturnValueOnce(false)
      expect(openSessionInNextPane()).toBe(false)
      expect(h.applyPreset).toHaveBeenCalledWith('2')
      h.applyPreset.mockReturnValueOnce(true)
      h.neighbour = null
      expect(openSessionInNextPane()).toBe(true)
      expect(h.setState).not.toHaveBeenCalled()
    })
  })

  describe('useLayoutPresetEffects', () => {
    it('wires nothing while disabled', () => {
      renderHook(() => useLayoutPresetEffects(false))
      window.dispatchEvent(new CustomEvent('omniterm:change-layout', { detail: { mode: 4 } }))
      expect(h.applyPreset).not.toHaveBeenCalled()
      expect(h.restorer).not.toHaveBeenCalled()
    })

    it('applies numbered layouts, ignoring invalid modes', () => {
      renderHook(() => useLayoutPresetEffects(true))
      for (const mode of [4, 0, 9, 2.5, 'x', undefined]) {
        window.dispatchEvent(new CustomEvent('omniterm:change-layout', { detail: { mode } }))
      }
      window.dispatchEvent(new CustomEvent('omniterm:change-layout'))
      expect(h.applyPreset).toHaveBeenCalledTimes(1)
      expect(h.applyPreset).toHaveBeenCalledWith('preset-4')
    })

    it('leaves a maximized pane on Escape unless the event was handled', () => {
      renderHook(() => useLayoutPresetEffects(true))
      h.restoreMaximized.mockReturnValueOnce(true)
      const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
      window.dispatchEvent(handled)
      expect(handled.defaultPrevented).toBe(true)
      h.restoreMaximized.mockReturnValueOnce(false)
      const idle = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
      window.dispatchEvent(idle)
      expect(idle.defaultPrevented).toBe(false)
      const other = new KeyboardEvent('keydown', { key: 'a', cancelable: true })
      const before = h.restoreMaximized.mock.calls.length
      window.dispatchEvent(other)
      expect(h.restoreMaximized.mock.calls.length).toBe(before)
      const prevented = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
      prevented.preventDefault()
      window.dispatchEvent(prevented)
      expect(h.restoreMaximized.mock.calls.length).toBe(before)
    })

    it('opens a session in the next pane on request', () => {
      renderHook(() => useLayoutPresetEffects(true))
      window.dispatchEvent(new Event('omniterm:new-pane-current-directory'))
      expect(h.newSessionLike).toHaveBeenCalledWith('s1')
    })

    it('toggles maximize through its action and cleans up on unmount', () => {
      const { unmount } = renderHook(() => useLayoutPresetEffects(true))
      expect(h.restorer).toHaveBeenCalledOnce()
      h.restoreMaximized.mockReturnValueOnce(false)
      h.action?.run()
      expect(h.maximizeActivePane).toHaveBeenCalledOnce()
      h.restoreMaximized.mockReturnValueOnce(true)
      h.action?.run()
      expect(h.maximizeActivePane).toHaveBeenCalledOnce()
      unmount()
      expect(h.stopRestorer).toHaveBeenCalledOnce()
      expect(h.stopAction).toHaveBeenCalledOnce()
      expect(h.stopTitle).toHaveBeenCalledOnce()
      window.dispatchEvent(new CustomEvent('omniterm:change-layout', { detail: { mode: 3 } }))
      expect(h.applyPreset).not.toHaveBeenCalled()
    })
  })
})
