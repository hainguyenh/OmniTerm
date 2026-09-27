/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import {
  isRenewing,
  requestRenewFromPane,
  useRenewSession,
  resetRenewRememberedForTests,
  getRenewRemembered,
} from '../useRenewSession'
import * as agentSessionStorage from '../../utils/agentSessionStorage'
import { resetPanePresenceForTests, setPanePresence } from '../../utils/agentPresenceStore'

describe('useRenewSession', () => {
  const localDisconnect = vi.fn().mockResolvedValue(undefined)
  const localInput = vi.fn()
  const openShell = vi.fn()
  const releaseShell = vi.fn()
  const reconnectSession = vi.fn()
  const setActiveTabs = vi.fn()
  const setEphemeralConns = vi.fn()

  const makeConn = (overrides: Partial<Connection>): Connection => ({
    id: 'conn-1',
    name: 'Claude Code',
    type: 'LOCAL',
    host: '',
    port: '0',
    user: '',
    ...overrides,
  })

  const tabs = [
    { id: 'tab-1', connId: 'conn-1', name: 'Claude Code (profile: work)' },
    { id: 'tab-2', connId: 'conn-2', name: 'PowerShell' },
  ]

  const conns: Record<string, Connection> = {
    'conn-1': makeConn({
      id: 'conn-1',
      name: 'Claude Code',
      shell: 'powershell',
      localCwd: 'D:/workspace/project',
      workspaceId: 'ws-1',
    }),
  }

  const sessionCwds = {
    'tab-1': 'D:/workspace/project',
  }

  beforeEach(() => {
    resetRenewRememberedForTests()
    vi.clearAllMocks()

    ;(window as any).omnitermAPI = {
      connect: { localDisconnect, localInput },
      shells: { open: openShell, release: releaseShell },
    }

    vi.spyOn(agentSessionStorage, 'findSessionByTabId').mockReturnValue({
      id: 'stored-1',
      tabId: 'tab-1',
      agent: 'claude',
      profileName: 'work',
      launcher: 'claude-work',
      sessionId: 'claude-uuid-123',
      cwd: 'D:/workspace/project',
      state: 'active',
      updatedAt: 1000,
    })

    vi.spyOn(agentSessionStorage, 'clearActiveForTab').mockImplementation(() => {})
  })

  it('initially has no pending renew modal open', () => {
    const { result } = renderHook(() =>
      useRenewSession({
        activeTabs: tabs,
        setActiveTabs,
        ephemeralConns: [conns['conn-1']],
        setEphemeralConns,
        sessionCwds,
        connById: (id) => conns[id],
        reconnectSession,
        appSettings: { agentRenewStrategy: 'reopen' },
        activeTabId: 'tab-1',
      }),
    )

    expect(result.current.renewModalOpen).toBe(false)
    expect(result.current.pendingRenewSessionId).toBeNull()
    expect(result.current.pendingRenewSessionName).toBeUndefined()
  })

  it('opens modal on requestRenewSession when not remembered', () => {
    const { result } = renderHook(() =>
      useRenewSession({
        activeTabs: tabs,
        setActiveTabs,
        ephemeralConns: [conns['conn-1']],
        setEphemeralConns,
        sessionCwds,
        connById: (id) => conns[id],
        reconnectSession,
        appSettings: { agentRenewStrategy: 'reopen' },
        activeTabId: 'tab-1',
      }),
    )

    act(() => {
      result.current.requestRenewSession('tab-1')
    })

    expect(result.current.renewModalOpen).toBe(true)
    expect(result.current.pendingRenewSessionId).toBe('tab-1')
    expect(result.current.pendingRenewSessionName).toBe('Claude Code (profile: work)')
  })

  it('cancels modal when cancelRenew is called', () => {
    const { result } = renderHook(() =>
      useRenewSession({
        activeTabs: tabs,
        setActiveTabs,
        ephemeralConns: [conns['conn-1']],
        setEphemeralConns,
        sessionCwds,
        connById: (id) => conns[id],
        reconnectSession,
        appSettings: { agentRenewStrategy: 'reopen' },
        activeTabId: 'tab-1',
      }),
    )

    act(() => {
      result.current.requestRenewSession('tab-1')
    })
    expect(result.current.renewModalOpen).toBe(true)

    act(() => {
      result.current.cancelRenew()
    })
    expect(result.current.renewModalOpen).toBe(false)
    expect(result.current.pendingRenewSessionId).toBeNull()
  })

  it('executes reopen strategy on confirm: terminates processes and reopens profile command', async () => {
    const newConn = makeConn({
      id: 'conn-fresh',
      name: 'Claude Code',
      shell: 'powershell',
      localCwd: 'D:/workspace/project',
    })
    openShell.mockResolvedValue(newConn)

    const { result } = renderHook(() =>
      useRenewSession({
        activeTabs: tabs,
        setActiveTabs,
        ephemeralConns: [conns['conn-1']],
        setEphemeralConns,
        sessionCwds,
        connById: (id) => conns[id],
        reconnectSession,
        appSettings: { agentRenewStrategy: 'reopen' },
        activeTabId: 'tab-1',
      }),
    )

    act(() => {
      result.current.requestRenewSession('tab-1')
    })

    await act(async () => {
      await result.current.confirmRenew(false)
    })

    expect(localDisconnect).toHaveBeenCalledWith('tab-1')
    expect(openShell).toHaveBeenCalledWith(
      'powershell',
      'ws-1',
      undefined,
      'D:/workspace/project',
      'claude-work',
    )
    expect(releaseShell).toHaveBeenCalledWith('conn-1')
    expect(setEphemeralConns).toHaveBeenCalled()
    expect(setActiveTabs).toHaveBeenCalled()
    expect(agentSessionStorage.clearActiveForTab).toHaveBeenCalledWith('tab-1')
    expect(reconnectSession).toHaveBeenCalledWith('tab-1')
    expect(getRenewRemembered()).toBe(false)
  })

  it('remembers preference and bypasses modal on subsequent requests', async () => {
    const newConn = makeConn({
      id: 'conn-fresh',
      name: 'Claude Code',
    })
    openShell.mockResolvedValue(newConn)

    const { result } = renderHook(() =>
      useRenewSession({
        activeTabs: tabs,
        setActiveTabs,
        ephemeralConns: [conns['conn-1']],
        setEphemeralConns,
        sessionCwds,
        connById: (id) => conns[id],
        reconnectSession,
        appSettings: { agentRenewStrategy: 'reopen' },
        activeTabId: 'tab-1',
      }),
    )

    act(() => {
      result.current.requestRenewSession('tab-1')
    })

    await act(async () => {
      await result.current.confirmRenew(true)
    })

    expect(getRenewRemembered()).toBe(true)

    // Second request: modal is bypassed directly
    act(() => {
      result.current.requestRenewSession('tab-1')
    })

    expect(result.current.renewModalOpen).toBe(false)
    expect(localDisconnect).toHaveBeenCalledTimes(2)
  })

  it('executes new-command strategy by sending /new\\r', async () => {
    const { result } = renderHook(() =>
      useRenewSession({
        activeTabs: tabs,
        setActiveTabs,
        ephemeralConns: [conns['conn-1']],
        setEphemeralConns,
        sessionCwds,
        connById: (id) => conns[id],
        reconnectSession,
        appSettings: { agentRenewStrategy: 'new-command' },
        activeTabId: 'tab-1',
      }),
    )

    act(() => {
      result.current.requestRenewSession('tab-1')
    })

    await act(async () => {
      await result.current.confirmRenew(false)
    })

    // The command and its submit are separate writes, so an agent TUI can't read them as one paste.
    expect(localInput).toHaveBeenCalledWith('tab-1', '/new')
    await vi.waitFor(() => expect(localInput).toHaveBeenCalledWith('tab-1', '\r'))
    expect(localDisconnect).not.toHaveBeenCalled()
    expect(openShell).not.toHaveBeenCalled()
  })

  it('sends Claude Code its own new-conversation command (/clear)', async () => {
    setPanePresence({ 'tab-1': { agent: 'claude', profileName: 'claude-work', pid: 1, startTime: 1 } })
    const { result } = renderHook(() =>
      useRenewSession({
        activeTabs: tabs,
        setActiveTabs,
        ephemeralConns: [conns['conn-1']],
        setEphemeralConns,
        sessionCwds,
        connById: (id) => conns[id],
        reconnectSession,
        appSettings: { agentRenewStrategy: 'new-command' },
        activeTabId: 'tab-1',
      }),
    )
    act(() => { result.current.requestRenewSession('tab-1') })
    await act(async () => { await result.current.confirmRenew(false) })
    expect(localInput).toHaveBeenCalledWith('tab-1', '/clear')
    resetPanePresenceForTests()
  })

  it('marks the tab as renewing while its old process exits, so the exit cannot close it (regression)', async () => {
    let renewingDuringDisconnect = false
    localDisconnect.mockImplementationOnce(async () => { renewingDuringDisconnect = isRenewing('tab-1') })
    openShell.mockResolvedValueOnce(makeConn({ id: 'conn-new', shell: 'powershell' }))
    const { result } = renderHook(() =>
      useRenewSession({
        activeTabs: tabs,
        setActiveTabs,
        ephemeralConns: [conns['conn-1']],
        setEphemeralConns,
        sessionCwds,
        connById: (id) => conns[id],
        reconnectSession,
        appSettings: { agentRenewStrategy: 'reopen' },
        activeTabId: 'tab-1',
      }),
    )
    act(() => { result.current.requestRenewSession('tab-1') })
    await act(async () => { await result.current.confirmRenew(false) })

    expect(renewingDuringDisconnect).toBe(true)
    expect(isRenewing('tab-1')).toBe(true)
    expect(reconnectSession).toHaveBeenCalledWith('tab-1')
  })

  it('falls back to the live agent profile when no session is stored', async () => {
    vi.spyOn(agentSessionStorage, 'findSessionByTabId').mockReturnValue(undefined)
    setPanePresence({ 'tab-1': { agent: 'claude', profileName: 'claude-work', launcher: 'claude-work', pid: 1, startTime: 1 } })
    openShell.mockResolvedValueOnce(makeConn({ id: 'conn-new', shell: 'powershell' }))
    const { result } = renderHook(() =>
      useRenewSession({
        activeTabs: tabs,
        setActiveTabs,
        ephemeralConns: [conns['conn-1']],
        setEphemeralConns,
        sessionCwds,
        connById: (id) => conns[id],
        reconnectSession,
        appSettings: { agentRenewStrategy: 'reopen' },
        activeTabId: 'tab-1',
      }),
    )
    act(() => { result.current.requestRenewSession('tab-1') })
    await act(async () => { await result.current.confirmRenew(false) })

    expect(openShell).toHaveBeenCalledWith('powershell', 'ws-1', undefined, 'D:/workspace/project', 'claude-work')
    resetPanePresenceForTests()
  })

  it('does not renew an SSH session with a local shell', async () => {
    const sshConn = makeConn({ id: 'conn-ssh', type: 'SSH', host: 'h' })
    const { result } = renderHook(() =>
      useRenewSession({
        activeTabs: [{ id: 'tab-ssh', connId: 'conn-ssh', name: 'ssh' }],
        setActiveTabs,
        ephemeralConns: [],
        setEphemeralConns,
        sessionCwds: {},
        connById: () => sshConn,
        reconnectSession,
        appSettings: { agentRenewStrategy: 'reopen' },
        activeTabId: 'tab-ssh',
      }),
    )
    act(() => { result.current.requestRenewSession('tab-ssh') })
    await act(async () => { await result.current.confirmRenew(false) })
    expect(localDisconnect).not.toHaveBeenCalled()
    expect(openShell).not.toHaveBeenCalled()
  })

  it('opens the confirmation when a pane header asks for a renew', () => {
    const { result } = renderHook(() =>
      useRenewSession({
        activeTabs: tabs,
        setActiveTabs,
        ephemeralConns: [conns['conn-1']],
        setEphemeralConns,
        sessionCwds,
        connById: (id) => conns[id],
        reconnectSession,
        appSettings: { agentRenewStrategy: 'reopen' },
        activeTabId: 'tab-2',
      }),
    )
    act(() => { requestRenewFromPane('tab-1') })
    expect(result.current.pendingRenewSessionId).toBe('tab-1')
  })
})
