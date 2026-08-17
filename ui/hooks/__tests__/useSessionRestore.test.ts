/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Connection } from '@omniterm/contract'
import { useSessionRestore } from '../useSessionRestore'
import {
  SNAPSHOT_KEY,
  SNAPSHOT_VERSION,
  saveSnapshot,
  type SessionSnapshot,
} from '../../utils/sessionStore'
import { loadScrollback, saveScrollback } from '../../utils/scrollbackStore'
import { setPersistencePolicyOverride } from '../../utils/persistencePolicy'

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

function snapshot(
  policy: 'close-with-app' | 'keep-running' | 'recover-after-reboot' = 'recover-after-reboot',
): SessionSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    activeTabs: [{
      id: 'old-tab-1', sessionId: 'old-tab-1', generation: 2,
      persistencePolicy: policy, connId: 'old-adhoc-1', name: 'PowerShell',
      scrollbackKey: 'sb-old-tab-1',
    }],
    ephemeralConns: [{
      id: 'old-adhoc-1', name: 'PowerShell', type: 'LOCAL', ephemeral: true,
      shell: 'powershell', localCwd: 'F:/repo',
    }],
    viewGroups: [{
      id: 'ungrouped', label: 'Ungrouped', layoutMode: 2,
      panes: ['old-tab-1', null, null, null, null, null, null, 'ghost'], focusedPane: 7,
    }],
    tabGroups: { 'old-tab-1': 'ungrouped' },
    activeGroupId: 'ungrouped',
    layoutMode: 2,
  }
}

const setters = () => ({
  setActiveTabs: vi.fn(),
  setEphemeralConns: vi.fn(),
  setTabGroups: vi.fn(),
  setResumeMode: vi.fn(),
  restoreGroups: vi.fn(),
  setPanes: vi.fn(),
  setLayoutMode: vi.fn(),
  setFocusedPane: vi.fn(),
})

const applied = <T,>(setter: { mock: { calls: unknown[][] } }, prev: T): T =>
  (setter.mock.calls[0][0] as (p: T) => T)(prev)

describe('useSessionRestore', () => {
  const mockOpen = vi.fn()
  const listLocalSessions = vi.fn()

  beforeEach(() => {
    mockOpen.mockReset()
    listLocalSessions.mockReset().mockResolvedValue([])
    localStorage.clear()
    Object.defineProperty(window, 'omnitermAPI', {
      configurable: true,
      value: {
        shells: { open: mockOpen },
        connect: { listLocalSessions },
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('does nothing without a restorable snapshot', () => {
    const s = setters()
    renderHook(() => useSessionRestore({ initialSnapshot: null, ...s }))
    renderHook(() => useSessionRestore({ initialSnapshot: { ...snapshot(), activeTabs: [] }, ...s }))
    expect(listLocalSessions).not.toHaveBeenCalled()
    expect(mockOpen).not.toHaveBeenCalled()
  })

  it('reattaches a live daemon session without spawning or re-registering it', async () => {
    listLocalSessions.mockResolvedValue([{ id: 'old-tab-1', lifecycle: 'live', generation: 2 }])
    const s = setters()

    renderHook(() => useSessionRestore({ initialSnapshot: snapshot(), ...s }))
    await vi.waitFor(() => expect(s.setActiveTabs).toHaveBeenCalled())

    expect(mockOpen).not.toHaveBeenCalled()
    expect(applied(s.setActiveTabs, [])).toEqual([
      { id: 'old-tab-1', connId: 'old-adhoc-1', name: 'PowerShell' },
    ])
    expect(applied<Record<string, boolean>>(s.setResumeMode, {})).toEqual({ 'old-tab-1': true })
  })

  it('uses the interrupted daemon manifest policy when it is newer than the renderer snapshot', async () => {
    listLocalSessions.mockResolvedValue([{
      id: 'old-tab-1', lifecycle: 'interrupted', generation: 2, policy: 'recover-after-reboot',
    }])
    mockOpen.mockResolvedValue(registeredConn())
    const s = setters()

    renderHook(() => useSessionRestore({ initialSnapshot: snapshot('keep-running'), ...s }))
    await vi.waitFor(() => expect(s.setActiveTabs).toHaveBeenCalled())

    expect(applied<Record<string, boolean>>(s.setResumeMode, {})).toEqual({ 'old-tab-1': false })
  })

  it('uses an explicit policy override when the renderer snapshot is older than the user choice', async () => {
    setPersistencePolicyOverride('old-tab-1', 'recover-after-reboot')
    mockOpen.mockResolvedValue(registeredConn())
    const s = setters()

    renderHook(() => useSessionRestore({ initialSnapshot: snapshot('keep-running'), ...s }))
    await vi.waitFor(() => expect(s.setActiveTabs).toHaveBeenCalled())

    expect(applied<Record<string, boolean>>(s.setResumeMode, {})).toEqual({ 'old-tab-1': false })
  })

  it('cold-recovers only recover-after-reboot and preserves the stable session id', async () => {
    mockOpen.mockResolvedValue(registeredConn())
    const s = setters()

    renderHook(() => useSessionRestore({ initialSnapshot: snapshot(), ...s }))
    await vi.waitFor(() => expect(s.restoreGroups).toHaveBeenCalled())

    expect(mockOpen).toHaveBeenCalledWith('powershell', null, undefined, 'F:/repo', null)
    const tabs = applied<{ id: string; connId: string; name: string }[]>(s.setActiveTabs, [])
    expect(tabs).toEqual([{ id: 'old-tab-1', connId: 'adhoc-fresh-99', name: 'PowerShell' }])
    expect(applied<Record<string, boolean>>(s.setResumeMode, {})).toEqual({ 'old-tab-1': false })
    const groups = s.restoreGroups.mock.calls[0][0] as Array<{ panes: (string | null)[] }>
    expect(groups[0].panes[0]).toBe('old-tab-1')
    expect(groups[0].panes[7]).toBeNull()
    expect(s.setFocusedPane).toHaveBeenCalledWith(1)
  })

  it('uses a safe persisted AI resume command only for reboot recovery', async () => {
    mockOpen.mockResolvedValue(registeredConn({ id: 'agent-fresh' }))
    const s = setters()
    const saved = snapshot('recover-after-reboot')
    saved.activeTabs[0].name = 'Claude Code - repo'
    saved.ephemeralConns[0].initialCommand = 'claude --continue'

    renderHook(() => useSessionRestore({ initialSnapshot: saved, ...s }))
    await vi.waitFor(() => expect(mockOpen).toHaveBeenCalled())
    expect(mockOpen).toHaveBeenCalledWith(
      'powershell', null, undefined, 'F:/repo', 'claude --continue',
    )
  })

  it('does not relaunch a recover session that the live daemon recorded as closed', async () => {
    listLocalSessions.mockResolvedValue([{
      id: 'old-tab-1', lifecycle: 'closed', generation: 2, policy: 'recover-after-reboot',
    }])
    mockOpen.mockResolvedValue(registeredConn({ id: 'agent-stopped' }))
    const s = setters()
    const saved = snapshot('recover-after-reboot')
    saved.activeTabs[0].name = 'Claude Code - repo'
    saved.ephemeralConns[0].initialCommand = 'claude --continue'

    renderHook(() => useSessionRestore({ initialSnapshot: saved, ...s }))
    await vi.waitFor(() => expect(s.setActiveTabs).toHaveBeenCalled())

    expect(mockOpen).toHaveBeenCalledWith('powershell', null, undefined, 'F:/repo', null)
    expect(applied<Record<string, boolean>>(s.setResumeMode, {})).toEqual({ 'old-tab-1': true })
  })

  it.each(['keep-running', 'close-with-app'] as const)(
    're-registers %s ephemeral metadata but leaves the terminal stopped',
    async (policy) => {
      mockOpen.mockResolvedValue(registeredConn())
      const s = setters()
      renderHook(() => useSessionRestore({ initialSnapshot: snapshot(policy), ...s }))
      await vi.waitFor(() => expect(s.setActiveTabs).toHaveBeenCalled())

      expect(mockOpen).toHaveBeenCalledWith('powershell', null, undefined, 'F:/repo', null)
      expect(applied<Record<string, boolean>>(s.setResumeMode, {})).toEqual({ 'old-tab-1': true })
    },
  )

  it('keeps the snapshot for retry when shell registration fails', async () => {
    mockOpen.mockRejectedValue(new Error('backend unavailable'))
    const s = setters()
    const saved = snapshot()
    saveSnapshot(saved)

    renderHook(() => useSessionRestore({ initialSnapshot: saved, ...s }))
    await vi.waitFor(() => expect(mockOpen).toHaveBeenCalled())
    expect(s.setActiveTabs).not.toHaveBeenCalled()
    expect(localStorage.getItem(SNAPSHOT_KEY)).not.toBeNull()
  })

  it('consumes the snapshot only after at least one tab is restored', async () => {
    mockOpen.mockResolvedValue(registeredConn())
    const s = setters()
    const saved = snapshot()
    saveSnapshot(saved)

    renderHook(() => useSessionRestore({ initialSnapshot: saved, ...s }))
    await vi.waitFor(() => expect(s.setActiveTabs).toHaveBeenCalled())
    await vi.waitFor(() => expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull())
  })

  it('does not seed renderer state after unmount while registration is pending', async () => {
    let release: ((conn: Connection) => void) | undefined
    mockOpen.mockReturnValue(new Promise<Connection>((resolve) => { release = resolve }))
    const s = setters()
    const view = renderHook(() => useSessionRestore({ initialSnapshot: snapshot(), ...s }))
    view.unmount()
    release?.(registeredConn())
    await vi.waitFor(() => expect(mockOpen).toHaveBeenCalled())
    expect(s.setActiveTabs).not.toHaveBeenCalled()
  })

  it('keeps scrollback under the stable session key', async () => {
    mockOpen.mockResolvedValue(registeredConn())
    const s = setters()
    await saveScrollback('sb-old-tab-1', 'previous pane output')

    renderHook(() => useSessionRestore({ initialSnapshot: snapshot(), ...s }))
    await vi.waitFor(() => expect(s.setActiveTabs).toHaveBeenCalled())
    expect(await loadScrollback('sb-old-tab-1')).toBe('previous pane output')
  })
})
