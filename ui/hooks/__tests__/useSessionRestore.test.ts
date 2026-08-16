/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSessionRestore } from '../useSessionRestore'
import {
  SNAPSHOT_KEY,
  SNAPSHOT_VERSION,
  saveSnapshot,
  type SessionSnapshot,
} from '../../utils/sessionStore'
import { loadScrollback, saveScrollback } from '../../utils/scrollbackStore'
import type { Connection } from '@omniterm/contract'

const registeredConn = (over: Partial<Connection> = {}): Connection => ({
  id: 'adhoc-fresh-99',
  name: 'PowerShell',
  type: 'LOCAL',
  host: '',
  port: '',
  user: '',
  shell: 'powershell',
  ...over,
})

const setters = () => ({
  setActiveTabs: vi.fn(),
  setEphemeralConns: vi.fn(),
  setTabGroups: vi.fn(),
  restoreGroups: vi.fn(),
  setPanes: vi.fn(),
  setLayoutMode: vi.fn(),
  setFocusedPane: vi.fn(),
})

/** Invoke a setter's updater against `prev` the way React would. */
const applied = <T,>(setter: { mock: { calls: unknown[][] } }, prev: T): T =>
  (setter.mock.calls[0][0] as (p: T) => T)(prev)

describe('useSessionRestore', () => {
  const mockOpen = vi.fn()

  beforeEach(() => {
    mockOpen.mockReset()
    localStorage.clear()
    Object.defineProperty(window, 'omnitermAPI', {
      configurable: true,
      value: {
        shells: {
          open: mockOpen,
        },
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('does nothing when initialSnapshot is null', () => {
    const s = setters()
    renderHook(() => useSessionRestore({ initialSnapshot: null, ...s }))
    expect(mockOpen).not.toHaveBeenCalled()
    expect(s.setActiveTabs).not.toHaveBeenCalled()
  })

  it('does nothing when activeTabs is empty', () => {
    const s = setters()
    const snapshot: SessionSnapshot = {
      version: SNAPSHOT_VERSION,
      activeTabs: [],
      ephemeralConns: [],
      viewGroups: [],
      tabGroups: {},
      activeGroupId: 'ungrouped',
      layoutMode: 1,
    }
    renderHook(() => useSessionRestore({ initialSnapshot: snapshot, ...s }))
    expect(mockOpen).not.toHaveBeenCalled()
    expect(s.setActiveTabs).not.toHaveBeenCalled()
  })

  it('re-registers shells and seeds state with remapped ids', async () => {
    mockOpen.mockResolvedValue(registeredConn())
    const s = setters()

    const snapshot: SessionSnapshot = {
      version: SNAPSHOT_VERSION,
      activeTabs: [{ id: 'old-tab-1', connId: 'old-adhoc-1', name: 'PowerShell' }],
      ephemeralConns: [{ id: 'old-adhoc-1', name: 'PowerShell', shell: 'powershell' }],
      viewGroups: [
        {
          id: 'ungrouped',
          label: 'Ungrouped',
          layoutMode: 2,
          panes: ['old-tab-1', null, null, null, null, null, null, 'old-tab-ghost'],
          focusedPane: 7,
        },
      ],
      tabGroups: { 'old-tab-1': 'ungrouped' },
      activeGroupId: 'ungrouped',
      layoutMode: 2,
    }

    renderHook(() => useSessionRestore({ initialSnapshot: snapshot, ...s }))

    await vi.waitFor(() => expect(s.restoreGroups).toHaveBeenCalled())
    expect(mockOpen).toHaveBeenCalledWith('powershell', null, undefined, null, null)

    // Fresh tab ids derived from the new conn id, carrying the persisted display name.
    const tabs = applied<{ id: string; connId: string; name: string }[]>(s.setActiveTabs, [])
    expect(tabs).toHaveLength(1)
    expect(tabs[0].id).toMatch(/^adhoc-fresh-99_[0-9a-f-]+$/)
    expect(tabs[0].connId).toBe('adhoc-fresh-99')
    expect(tabs[0].name).toBe('PowerShell')

    // Pane slots remap to the new id; an unknown tab id becomes an empty slot.
    const groups = s.restoreGroups.mock.calls[0][0] as Array<{ panes: (string | null)[] }>
    expect(groups[0].panes[0]).toBe(tabs[0].id)
    expect(groups[0].panes[7]).toBeNull()
    expect(s.setPanes).toHaveBeenCalledWith(groups[0].panes)

    // tabGroups remap to the fresh id, and focusedPane is clamped to the layout's pane count.
    const tabGroups = applied<Record<string, string>>(s.setTabGroups, {})
    expect(tabGroups[tabs[0].id]).toBe('ungrouped')
    expect(s.setFocusedPane).toHaveBeenCalledWith(1)
  })

  it('restores AI agent session with initialCommand and localCwd', async () => {
    mockOpen.mockResolvedValue(
      registeredConn({ id: 'adhoc-agent-fresh', localCwd: 'F:/my-repo', localCommand: 'claude --resume' }),
    )
    const s = setters()

    const snapshot: SessionSnapshot = {
      version: SNAPSHOT_VERSION,
      activeTabs: [{ id: 'tab-agent', connId: 'conn-agent', name: 'claude: ~/my-repo' }],
      ephemeralConns: [
        { id: 'conn-agent', name: 'Local Shell', shell: 'powershell', localCwd: 'F:/my-repo', initialCommand: 'claude --resume' },
      ],
      viewGroups: [],
      tabGroups: {},
      activeGroupId: 'ungrouped',
      layoutMode: 1,
    }

    renderHook(() => useSessionRestore({ initialSnapshot: snapshot, ...s }))

    await vi.waitFor(() => {
      expect(mockOpen).toHaveBeenCalledWith(
        'powershell',
        null,
        undefined,
        'F:/my-repo',
        'claude --resume',
      )
    })
  })

  it('consumes the stored snapshot after applying, so a deliberately emptied layout stays empty', async () => {
    mockOpen.mockResolvedValue(registeredConn())
    const s = setters()

    const snapshot: SessionSnapshot = {
      version: SNAPSHOT_VERSION,
      activeTabs: [{ id: 'old-tab-1', connId: 'old-adhoc-1', name: 'PowerShell' }],
      ephemeralConns: [{ id: 'old-adhoc-1', name: 'PowerShell', shell: 'powershell' }],
      viewGroups: [],
      tabGroups: {},
      activeGroupId: 'ungrouped',
      layoutMode: 1,
    }
    saveSnapshot(snapshot)
    expect(localStorage.getItem(SNAPSHOT_KEY)).not.toBeNull()

    renderHook(() => useSessionRestore({ initialSnapshot: snapshot, ...s }))
    await vi.waitFor(() => expect(s.setActiveTabs).toHaveBeenCalled())
    await vi.waitFor(() => expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull())
  })

  it('keeps the snapshot for a later retry when every shell re-registration fails', async () => {
    mockOpen.mockRejectedValue(new Error('backend unavailable'))
    const s = setters()

    const snapshot: SessionSnapshot = {
      version: SNAPSHOT_VERSION,
      activeTabs: [{ id: 'old-tab-1', connId: 'old-adhoc-1', name: 'PowerShell' }],
      ephemeralConns: [{ id: 'old-adhoc-1', name: 'PowerShell', shell: 'powershell' }],
      viewGroups: [],
      tabGroups: {},
      activeGroupId: 'ungrouped',
      layoutMode: 1,
    }
    saveSnapshot(snapshot)

    renderHook(() => useSessionRestore({ initialSnapshot: snapshot, ...s }))
    await vi.waitFor(() => expect(mockOpen).toHaveBeenCalled())
    expect(s.setActiveTabs).not.toHaveBeenCalled()
    expect(localStorage.getItem(SNAPSHOT_KEY)).not.toBeNull()
  })

  it('restores only the tabs whose connection re-registered on partial failure', async () => {
    const ok = registeredConn({ id: 'adhoc-ok' })
    mockOpen.mockImplementationOnce(() => Promise.resolve(ok)).mockImplementationOnce(() =>
      Promise.reject(new Error('shell gone')),
    )
    const s = setters()

    const snapshot: SessionSnapshot = {
      version: SNAPSHOT_VERSION,
      activeTabs: [
        { id: 'tab-ok', connId: 'conn-ok', name: 'Kept' },
        { id: 'tab-bad', connId: 'conn-bad', name: 'Dropped' },
      ],
      ephemeralConns: [
        { id: 'conn-ok', name: 'Kept', shell: 'powershell' },
        { id: 'conn-bad', name: 'Dropped', shell: 'powershell' },
      ],
      viewGroups: [],
      tabGroups: {},
      activeGroupId: 'ungrouped',
      layoutMode: 1,
    }

    renderHook(() => useSessionRestore({ initialSnapshot: snapshot, ...s }))
    await vi.waitFor(() => expect(s.setActiveTabs).toHaveBeenCalled())

    const tabs = applied<{ id: string; connId: string; name: string }[]>(s.setActiveTabs, [])
    expect(tabs).toHaveLength(1)
    expect(tabs[0].name).toBe('Kept')
  })

  it('seeds no state when unmounted before shells.open settles', async () => {
    let release: ((c: Connection) => void) | undefined
    mockOpen.mockReturnValue(new Promise<Connection>((resolve) => { release = resolve }))
    const s = setters()

    const snapshot: SessionSnapshot = {
      version: SNAPSHOT_VERSION,
      activeTabs: [{ id: 'old-tab-1', connId: 'old-adhoc-1', name: 'PowerShell' }],
      ephemeralConns: [{ id: 'old-adhoc-1', name: 'PowerShell', shell: 'powershell' }],
      viewGroups: [],
      tabGroups: {},
      activeGroupId: 'ungrouped',
      layoutMode: 1,
    }

    const view = renderHook(() => useSessionRestore({ initialSnapshot: snapshot, ...s }))
    view.unmount()
    release?.(registeredConn())
    await vi.waitFor(() => expect(mockOpen).toHaveBeenCalled())

    expect(s.setActiveTabs).not.toHaveBeenCalled()
    expect(s.restoreGroups).not.toHaveBeenCalled()
  })

  it('carries saved scrollback across the tab id remap', async () => {
    mockOpen.mockResolvedValue(registeredConn())
    const s = setters()

    await saveScrollback('sb-old-tab-1', 'previous pane output')

    const snapshot: SessionSnapshot = {
      version: SNAPSHOT_VERSION,
      activeTabs: [{ id: 'old-tab-1', connId: 'old-adhoc-1', name: 'PowerShell', scrollbackKey: 'sb-old-tab-1' }],
      ephemeralConns: [{ id: 'old-adhoc-1', name: 'PowerShell', shell: 'powershell' }],
      viewGroups: [],
      tabGroups: {},
      activeGroupId: 'ungrouped',
      layoutMode: 1,
    }

    renderHook(() => useSessionRestore({ initialSnapshot: snapshot, ...s }))
    await vi.waitFor(() => expect(s.setActiveTabs).toHaveBeenCalled())

    const tabs = applied<{ id: string; connId: string; name: string }[]>(s.setActiveTabs, [])
    // The memory fallback (no IndexedDB under jsdom) still proves the re-key: the new key
    // holds the old buffer and the old key is gone.
    await vi.waitFor(async () => {
      expect(await loadScrollback(`sb-${tabs[0].id}`)).toBe('previous pane output')
    })
    expect(await loadScrollback('sb-old-tab-1')).toBeNull()
  })
})
