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

describe('useRenewSession skip confirm', () => {
  const localDisconnect = vi.fn().mockResolvedValue(undefined)
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

  const sessionCwds: Record<string, string> = {
    'tab-1': 'D:/workspace/project',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetRenewRememberedForTests()
    ;(window as any).omnitermAPI = {
      connect: { localDisconnect },
      shells: { open: openShell, release: releaseShell },
      settings: { save: vi.fn().mockResolvedValue(undefined) },
    }
  })

  it('bypasses modal on requestRenewSession when skipTerminalRenewConfirm is true', async () => {
    const newConn = makeConn({ id: 'conn-fresh' })
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
        appSettings: { agentRenewStrategy: 'reopen', skipTerminalRenewConfirm: true },
        activeTabId: 'tab-1',
      }),
    )

    act(() => {
      result.current.requestRenewSession('tab-1')
    })

    expect(result.current.renewModalOpen).toBe(false)
    expect(result.current.pendingRenewSessionId).toBeNull()
  })

  it('persists skipTerminalRenewConfirm when remember choice is confirmed', async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined)
    ;(window as any).omnitermAPI.settings = { save: saveSettings }
    const newConn = makeConn({ id: 'conn-fresh' })
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
    expect(result.current.renewModalOpen).toBe(true)

    await act(async () => {
      await result.current.confirmRenew(true)
    })

    expect(saveSettings).toHaveBeenCalledWith({ skipTerminalRenewConfirm: true })
    expect(getRenewRemembered()).toBe(true)
  })
})
