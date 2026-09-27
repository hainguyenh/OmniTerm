/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import {
  useRenewSession,
  resetRenewRememberedForTests,
  getRenewRemembered,
} from '../useRenewSession'
import * as agentSessionStorage from '../../utils/agentSessionStorage'

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

    expect(localInput).toHaveBeenCalledWith('tab-1', '/new\r')
    expect(localDisconnect).not.toHaveBeenCalled()
    expect(openShell).not.toHaveBeenCalled()
  })
})
