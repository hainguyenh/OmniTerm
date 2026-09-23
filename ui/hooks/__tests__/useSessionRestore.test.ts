/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Connection } from '@omniterm/contract'
import { useSessionRestore } from '../useSessionRestore'
import { SNAPSHOT_VERSION, type SessionSnapshot } from '../../utils/sessionStore'

const registeredConn = (over: Partial<Connection> = {}): Connection => ({
  id: 'adhoc-fresh-99',
  name: 'PowerShell',
  type: 'LOCAL',
  host: '',
  port: '',
  user: '',
  shell: 'powershell',
  localCwd: 'F:/repo',
  ...over,
})

function snapshot(): SessionSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    activeTabs: [{
      id: 'old-tab-1',
      connId: 'old-adhoc-1',
      name: 'PowerShell',
      recovery: { cwd: 'F:/repo', cwdSource: 'reported', shell: 'powershell' },
    }],
    ephemeralConns: [{
      id: 'old-adhoc-1',
      name: 'PowerShell',
      type: 'LOCAL',
      ephemeral: true,
      shell: 'powershell',
      localCwd: 'F:/repo',
    }],
    viewGroups: [{
      id: 'ungrouped',
      label: 'Ungrouped',
      layoutMode: 2,
      panes: ['old-tab-1', null, null, null, null, null, null, 'ghost'],
      focusedPane: 7,
    }],
    tabGroups: { 'old-tab-1': 'ungrouped' },
    activeGroupId: 'ungrouped',
    layoutMode: 2,
    revision: 0,
  }
}

const setters = () => ({
  setActiveTabs: vi.fn(),
  setEphemeralConns: vi.fn(),
  setTabGroups: vi.fn(),
  setResumeMode: vi.fn(),
  setRestoreOutcomes: vi.fn(),
  restoreGroups: vi.fn(),
  setPanes: vi.fn(),
  setLayoutMode: vi.fn(),
  setFocusedPane: vi.fn(),
})

const applied = <T,>(setter: { mock: { calls: unknown[][] } }, prev: T): T =>
  (setter.mock.calls[0][0] as (p: T) => T)(prev)

describe('useSessionRestore', () => {
  const mockOpen = vi.fn()
  const mockRelease = vi.fn()
  const localDisconnect = vi.fn()

  beforeEach(() => {
    mockOpen.mockReset()
    mockRelease.mockReset()
    localDisconnect.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(window, 'omnitermAPI', {
      configurable: true,
      value: {
        shells: { open: mockOpen, release: mockRelease },
        connect: { localDisconnect },
      },
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('does nothing without a saved pane', () => {
    const s = setters()
    renderHook(() => useSessionRestore({ initialSnapshot: null, ...s }))
    renderHook(() => useSessionRestore({ initialSnapshot: { ...snapshot(), activeTabs: [] }, ...s }))
    expect(localDisconnect).not.toHaveBeenCalled()
    expect(mockOpen).not.toHaveBeenCalled()
  })

  it('kills stale process state and recreates the pane in its saved working directory', async () => {
    mockOpen.mockResolvedValue(registeredConn())
    const s = setters()

    renderHook(() => useSessionRestore({ initialSnapshot: snapshot(), ...s }))
    await vi.waitFor(() => expect(s.setActiveTabs).toHaveBeenCalled())

    expect(localDisconnect).toHaveBeenCalledWith('old-tab-1')
    expect(mockOpen).toHaveBeenCalledWith('powershell', null, undefined, 'F:/repo', null)
    expect(applied(s.setActiveTabs, [])).toEqual([
      { id: 'old-tab-1', connId: 'adhoc-fresh-99', name: 'PowerShell' },
    ])
    expect(applied<Record<string, boolean>>(s.setResumeMode, {})).toEqual({ 'old-tab-1': false })

    const groups = s.restoreGroups.mock.calls[0][0] as Array<{ panes: (string | null)[] }>
    expect(groups[0].panes[0]).toBe('old-tab-1')
    expect(groups[0].panes[7]).toBeNull()
    expect(s.setLayoutMode).toHaveBeenCalledWith(2)
    expect(s.setFocusedPane).toHaveBeenCalledWith(1)
    expect(s.setRestoreOutcomes.mock.calls.at(-1)?.[0]?.['old-tab-1']).toMatchObject({
      phase: 'recovering',
      retryable: false,
    })
  })

  it('does not repeat restore when ordinary connection callbacks change', async () => {
    mockOpen.mockResolvedValue(registeredConn())
    const s = setters()
    const saved = snapshot()
    const view = renderHook(({ resolveConnection }) => useSessionRestore({
      initialSnapshot: saved,
      ...s,
      resolveConnection,
    }), { initialProps: { resolveConnection: () => undefined as Connection | undefined } })

    await vi.waitFor(() => expect(s.setActiveTabs).toHaveBeenCalled())
    view.rerender({ resolveConnection: () => registeredConn() })

    expect(localDisconnect).toHaveBeenCalledTimes(1)
    expect(mockOpen).toHaveBeenCalledTimes(1)
  })

  it('retries by starting another fresh shell under the stable pane id', async () => {
    mockOpen
      .mockResolvedValueOnce(registeredConn({ id: 'adhoc-fresh-1' }))
      .mockResolvedValueOnce(registeredConn({ id: 'adhoc-fresh-2' }))
    let tabs: { id: string; connId: string; name: string }[] = []
    const s = setters()
    const setActiveTabs = vi.fn((update: (previous: typeof tabs) => typeof tabs) => {
      tabs = update(tabs)
    })
    const view = renderHook(({ retryToken }) => useSessionRestore({
      initialSnapshot: snapshot(),
      ...s,
      setActiveTabs,
      retryToken,
    }), { initialProps: { retryToken: 0 } })

    await vi.waitFor(() => expect(tabs[0]?.connId).toBe('adhoc-fresh-1'))
    view.rerender({ retryToken: 1 })
    await vi.waitFor(() => expect(tabs[0]?.connId).toBe('adhoc-fresh-2'))

    expect(localDisconnect).toHaveBeenCalledTimes(2)
    expect(tabs).toEqual([{ id: 'old-tab-1', connId: 'adhoc-fresh-2', name: 'PowerShell' }])
  })

  it('keeps a retryable placeholder when fresh shell registration fails', async () => {
    mockOpen.mockRejectedValue(new Error('backend unavailable'))
    const s = setters()

    renderHook(() => useSessionRestore({ initialSnapshot: snapshot(), ...s }))
    await vi.waitFor(() => expect(s.setActiveTabs).toHaveBeenCalled())

    expect(applied(s.setActiveTabs, [])).toEqual([
      { id: 'old-tab-1', connId: 'old-adhoc-1', name: 'PowerShell' },
    ])
    expect(s.setRestoreOutcomes.mock.calls.at(-1)?.[0]?.['old-tab-1']).toMatchObject({
      phase: 'failed',
      retryable: true,
      action: 'retry-session',
    })
  })

  it('releases a registration that resolves after its pane was explicitly closed', async () => {
    let resolveOpen: ((connection: Connection) => void) | undefined
    let allowed = true
    mockOpen.mockReturnValue(new Promise<Connection>(resolve => { resolveOpen = resolve }))
    const s = setters()

    renderHook(() => useSessionRestore({
      initialSnapshot: snapshot(),
      isRestoreAllowed: () => allowed,
      ...s,
    }))
    await vi.waitFor(() => expect(mockOpen).toHaveBeenCalled())
    allowed = false
    resolveOpen?.(registeredConn({ id: 'closed-pane-registration' }))

    await vi.waitFor(() => expect(mockRelease).toHaveBeenCalledWith('closed-pane-registration'))
    expect(s.setActiveTabs).not.toHaveBeenCalled()
  })
})
