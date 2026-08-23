/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useViewGroups } from '../../hooks/useViewGroups'
import { DEFAULT_VIEW_GROUP_ID, createDefaultViewGroup, createViewGroup } from '../../viewGroups'
import type { LayoutMode } from '../../themes'
import { useMainLayoutSessions } from '../useMainLayoutSessions'

vi.mock('../../hooks/useDetachControl', () => ({
  useDetachControl: () => ({ stateOf: vi.fn(() => null), toggle: vi.fn() }),
}))
vi.mock('../../hooks/useScriptRuns', () => ({
  useScriptRuns: () => ({ pairWithRun: vi.fn(), noteShellOpen: vi.fn() }),
}))

Object.defineProperty(window, 'omnitermAPI', {
  configurable: true,
  value: {
    shells: { onOpen: vi.fn(() => vi.fn()), ready: vi.fn() },
    connect: { rdpSetOverlay: vi.fn() },
  },
})

interface HarnessOptions {
  tabs: Array<{ id: string; connId: string; name: string }>
  panes: (string | null)[]
  layoutMode: LayoutMode
  focusedPane?: number
  useActualGroups?: boolean
  split3Style?: 'left' | 'right' | 'top'
}

function useHarness(options: HarnessOptions) {
  const [appSettings] = useState<AppSettings>({
    themeId: 'test',
    fontSize: 14,
    smartColors: true,
    checkUpdatesOnStartup: true,
    darkMode: true,
    split3Style: options.split3Style,
  })
  const [layoutMode, setLayoutMode] = useState(options.layoutMode)
  const [activeTabs, setActiveTabs] = useState(options.tabs)
  const [panes, setPanes] = useState(options.panes)
  const [focusedPane, setFocusedPane] = useState(options.focusedPane ?? 0)
  const [, setPanePicker] = useState<number | null>(null)
  const [mockTabGroups, setMockTabGroups] = useState<Record<string, string>>({})
  const actualGroups = useViewGroups({ layoutMode, setLayoutMode, panes, setPanes, focusedPane, setFocusedPane })
  const viewGroups = options.useActualGroups
    ? actualGroups.viewGroups
    : [{ ...createDefaultViewGroup(layoutMode), panes: [...panes] }]
  const activeGroupId = options.useActualGroups ? actualGroups.activeGroupId : DEFAULT_VIEW_GROUP_ID
  const tabGroups = options.useActualGroups ? actualGroups.tabGroups : mockTabGroups
  const setTabGroups = options.useActualGroups ? actualGroups.setTabGroups : setMockTabGroups
  const base = {
  sessionCwds: {}, workspaces: [],
    appSettings,
    setAppSettings: vi.fn(),
    themes: [],
    resolveAppearance: vi.fn(),
    onActiveTerminalChange: vi.fn(),
    onFontSizeChange: vi.fn(),
    onThemeApply: vi.fn(),
    layoutMode,
    setLayoutMode,
    activeTabs,
    setActiveTabs,
    tabGroups,
    setTabGroups,
    viewGroups,
    activeGroupId,
    switchViewGroup: vi.fn(),
    createNewViewGroup: vi.fn(),
    panes,
    setPanes,
    focusedPane,
    setFocusedPane,
    setPanePicker,
    activeTabId: panes[focusedPane] ?? null,
    setFullscreenPane: vi.fn(),
    connById: vi.fn(),
    handleConnectRef: useRef(() => {}),
    editorTabs: {},
    showAlert: vi.fn(),
    statuses: {},
    activeView: null,
    setActiveView: vi.fn(),
    connFormOpen: false,
    settingsOpen: false,
    dataMenuOpen: false,
    panePicker: null,
    dragPane: null,
    focusTerminal: vi.fn(),
  } as any
  return { base, sessions: useMainLayoutSessions(base) }
}

describe('useMainLayoutSessions view mode changes', () => {
  it('docks the first Ungrouped tab when an existing group expands', () => {
    const { result } = renderHook(() => useHarness({
      useActualGroups: true,
      tabs: [
        { id: 'a', connId: 'local', name: 'A' },
        { id: 'b', connId: 'ssh', name: 'B' },
        { id: 'c', connId: 'rdp', name: 'C' },
      ],
      panes: ['a', 'b', null, null, null, null, null, null],
      layoutMode: 2,
    }))

    act(() => result.current.sessions.changeLayoutMode(3))

    expect(result.current.base.panes.slice(0, 3)).toEqual(['a', 'b', 'c'])
    expect(result.current.base.tabGroups.c).toBe(result.current.base.activeGroupId)
  })

  it('returns the last non-focused pane to Ungrouped when a group shrinks', () => {
    const { result } = renderHook(() => useHarness({
      useActualGroups: true,
      tabs: [
        { id: 'a', connId: 'local', name: 'A' },
        { id: 'b', connId: 'ssh', name: 'B' },
        { id: 'c', connId: 'rdp', name: 'C' },
      ],
      panes: ['a', 'b', 'c', null, null, null, null, null],
      layoutMode: 3,
    }))

    act(() => result.current.sessions.changeLayoutMode(2))

    expect(result.current.base.panes.slice(0, 2)).toEqual(['a', 'b'])
    expect(result.current.base.tabGroups.c).toBeUndefined()
    expect(result.current.base.viewGroups.find((group: ReturnType<typeof createViewGroup>) => group.id === result.current.base.activeGroupId)?.panes.slice(0, 3)).toEqual(['a', 'b', null])
  })

  it('moves an Ungrouped tab into the selected dock and releases the replaced tab', () => {
    const { result } = renderHook(() => useHarness({
      useActualGroups: true,
      tabs: [
        { id: 'a', connId: 'local', name: 'A' },
        { id: 'b', connId: 'ssh', name: 'B' },
        { id: 'c', connId: 'rdp', name: 'C' },
      ],
      panes: ['a', 'b', null, null, null, null, null, null],
      layoutMode: 2,
    }))

    act(() => result.current.sessions.assignToPane(1, 'c'))

    expect(result.current.base.panes.slice(0, 2)).toEqual(['a', 'c'])
    expect(result.current.base.tabGroups.c).toBe(result.current.base.activeGroupId)
    expect(result.current.base.tabGroups.b).toBeUndefined()
  })

  it('keeps pane tabs in visual order when a mirrored three-pane layout shrinks', () => {
    const { result } = renderHook(() => useHarness({
      tabs: [
        { id: 'right', connId: 'local', name: 'Right' },
        { id: 'left-top', connId: 'ssh', name: 'Left top' },
        { id: 'left-bottom', connId: 'rdp', name: 'Left bottom' },
      ],
      panes: ['right', 'left-top', 'left-bottom', null, null, null, null, null],
      layoutMode: 3,
      focusedPane: 1,
      split3Style: 'right',
    }))

    act(() => result.current.sessions.changeLayoutMode(2))

    expect(result.current.base.panes.slice(0, 2)).toEqual(['left-top', 'right'])
    expect(result.current.base.focusedPane).toBe(0)
  })
})
