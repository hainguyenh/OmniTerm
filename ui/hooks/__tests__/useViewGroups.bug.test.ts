/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, beforeAll } from 'vitest'
import { useMainLayoutBase } from '../../components/useMainLayoutBase'
import { useMainLayoutSessions } from '../../components/useMainLayoutSessions'

beforeAll(() => {
  (window as any).omnitermAPI = {
    terminalWindow: { detach: () => {}, attach: () => {}, onReattached: () => () => {}, onPoppedOut: () => () => {}, onClosed: () => () => {} },
    plugin: { list: () => Promise.resolve([]), connectionCapabilities: () => Promise.resolve([]), invoke: () => Promise.resolve(null) },
    script: { list: () => Promise.resolve([]) },
    shells: { onOpen: () => () => {}, onClose: () => () => {}, list: () => Promise.resolve([]), ready: () => {} },
    appearance: { onThemeChange: () => () => {} },
    customArt: { get: () => Promise.resolve(null) },
    connect: { onRDPDetachState: () => () => {}, rdpSetOverlay: () => {} },
    workspace: { list: () => Promise.resolve([]) },
    app: { platform: 'win32' },
    settings: {
      get: () => Promise.resolve({}),
      set: () => Promise.resolve(),
      onDidChange: () => () => {}
    }
  }
})

describe('bug', () => {
  it('reproduces the bug', () => {
    const { result: base } = renderHook(() => useMainLayoutBase({
      appSettings: {}, setAppSettings: () => {}, currentTheme: null as any, themes: [],
      layoutMode: 1, setLayoutMode: () => {}
    } as any))
    
    const { result } = renderHook(() => useMainLayoutSessions(base.current))
    
    // Setup initial state: 3 active tabs
    act(() => {
      base.current.setActiveTabs([
        { id: 'tab-1', connId: '1', name: 'A' },
        { id: 'tab-2', connId: '2', name: 'B' },
        { id: 'tab-3', connId: '3', name: 'C' }
      ])
    })

    // Create view 1 (2 tabs)
    act(() => {
      base.current.createNewViewGroup('tab-1', true)
    })
    const view1Id = base.current.activeGroupId
    act(() => {
      base.current.setLayoutMode(3)
    })
    act(() => {
      result.current.assignToPane(1, 'tab-2')
    })
    
    // Create view 2 (1 tab)
    act(() => {
      base.current.createNewViewGroup('tab-3', true)
    })
    const view2Id = base.current.activeGroupId
    console.log("view2Id in test:", view2Id)
    act(() => {
      base.current.setLayoutMode(2)
    })
    
    // Switch to view 1
    act(() => {
      base.current.switchViewGroup(view1Id)
    })
    
    // dock tab-3 from view 2 into view 1
    act(() => {
      result.current.assignToPane(2, 'tab-3')
    })
    
    // Assert view 2 is disposed!
    expect(base.current.viewGroups.find(g => g.id === view2Id)).toBeUndefined()
    
    // undock tab-3 from view 12 should be disposed!
    expect(base.current.viewGroups.some(g => g.id === view2Id)).toBe(false)
    
    // Undock tab-3 from view 1
    act(() => {
      result.current.clearPane(2)
    })
    
    // The tab should now be ungrouped!
    expect(base.current.tabGroups['tab-3']).toBeUndefined()
  })
})
