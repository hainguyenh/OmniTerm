/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSessionPersistence } from '../useSessionPersistence'
import { loadSnapshot, SNAPSHOT_KEY, SNAPSHOT_VERSION, type SessionSnapshot } from '../../utils/sessionStore'

function makeStoredSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    activeTabs: [{
      id: 'tab-1', sessionId: 'tab-1', generation: 1, persistencePolicy: 'close-with-app',
      connId: 'adhoc-1', name: 'PowerShell',
    }],
    ephemeralConns: [{ id: 'adhoc-1', name: 'PowerShell', type: 'LOCAL', ephemeral: true, shell: 'powershell' }],
    viewGroups: [{
      id: 'ungrouped', label: 'Ungrouped', layoutMode: 1,
      panes: ['tab-1', null, null, null, null, null, null, null], focusedPane: 0, persistent: true,
    }],
    tabGroups: {},
    activeGroupId: 'ungrouped',
    layoutMode: 1,
    ...overrides,
  }
}

const baseConn = {
  id: 'adhoc-1', name: 'PowerShell', type: 'LOCAL' as const, host: '', port: '', user: '',
  shell: 'powershell' as const,
}
const baseTab = { id: 'tab-1', connId: 'adhoc-1', name: 'PowerShell' }
const baseGroup = {
  id: 'ungrouped', label: 'Ungrouped', layoutMode: 1 as const,
  panes: ['tab-1', null, null, null, null, null, null, null] as (string | null)[],
  focusedPane: 0, persistent: true as const,
}

async function flushDebounce(): Promise<void> {
  await act(async () => {
    vi.runAllTimers()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useSessionPersistence', () => {
  let storage: Record<string, string> = {}
  const listLocalSessions = vi.fn()
  const setPersistencePolicy = vi.fn()

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, val: string) => { storage[key] = val },
      removeItem: (key: string) => { delete storage[key] },
    })
    listLocalSessions.mockReset().mockResolvedValue([])
    setPersistencePolicy.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(window, 'omnitermAPI', {
      configurable: true,
      value: { connect: { listLocalSessions, setPersistencePolicy } },
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('loads the initial snapshot once and leaves an empty layout from overwriting it', async () => {
    storage[SNAPSHOT_KEY] = JSON.stringify(makeStoredSnapshot())
    const { result, rerender } = renderHook(() => useSessionPersistence({
      activeTabs: [], ephemeralConns: [], viewGroups: [], tabGroups: {},
      activeGroupId: 'ungrouped', layoutMode: 1,
    }))
    const first = result.current.initialSnapshot
    rerender()
    await flushDebounce()
    expect(result.current.initialSnapshot).toBe(first)
    expect(loadSnapshot()?.activeTabs[0].id).toBe('tab-1')
  })

  it('checkpoints a new PTY tab before the debounce window', () => {
    renderHook(() => useSessionPersistence({
      activeTabs: [baseTab], ephemeralConns: [baseConn], viewGroups: [baseGroup],
      tabGroups: {}, activeGroupId: 'ungrouped', layoutMode: 1,
    }))

    expect(loadSnapshot()?.activeTabs[0]).toMatchObject({
      id: 'tab-1', sessionId: 'tab-1', persistencePolicy: 'close-with-app',
    })
    expect(listLocalSessions).not.toHaveBeenCalled()
    expect(setPersistencePolicy).toHaveBeenCalledWith('tab-1', 'close-with-app')
  })

  it('flushes the latest pane layout on pagehide without waiting for the debounce', () => {
    const { rerender } = renderHook((group: typeof baseGroup) => useSessionPersistence({
      activeTabs: [baseTab], ephemeralConns: [baseConn], viewGroups: [group],
      tabGroups: {}, activeGroupId: 'ungrouped', layoutMode: 1,
    }), { initialProps: baseGroup })
    const moved = { ...baseGroup, panes: [null, 'tab-1', null, null, null, null, null, null] }
    rerender(moved)

    window.dispatchEvent(new Event('pagehide'))

    expect(loadSnapshot()?.viewGroups[0].panes[1]).toBe('tab-1')
    expect(listLocalSessions).not.toHaveBeenCalled()
  })

  it('persists daemon generation and sends the effective ordinary-terminal policy', async () => {
    listLocalSessions.mockResolvedValue([{
      id: 'tab-1', generation: 7, policy: 'keep-running', lifecycle: 'live',
      label: 'PowerShell', busy: false, launchedWithCommand: false, ssh: false,
    }])
    renderHook(() => useSessionPersistence({
      activeTabs: [baseTab], ephemeralConns: [baseConn], viewGroups: [baseGroup],
      tabGroups: {}, activeGroupId: 'ungrouped', layoutMode: 1,
    }))
    await flushDebounce()

    const saved = loadSnapshot()
    expect(saved?.activeTabs[0]).toMatchObject({
      id: 'tab-1', sessionId: 'tab-1', generation: 7, persistencePolicy: 'close-with-app',
      scrollbackKey: 'sb-tab-1',
    })
    expect(saved?.ephemeralConns[0]).toMatchObject({ type: 'LOCAL', ephemeral: true, shell: 'powershell' })
    expect(setPersistencePolicy).toHaveBeenCalledWith('tab-1', 'close-with-app')
  })

  it('defaults agent tabs to close-with-app but still checkpoints a safe resume command', async () => {
    const agentConn = {
      id: 'adhoc-agent', name: 'claude', type: 'LOCAL' as const, host: '', port: '', user: '',
      shell: 'powershell' as const, localCwd: 'F:/repo',
    }
    const agentTab = { id: 'tab-agent', connId: 'adhoc-agent', name: 'Claude Code - repo' }
    renderHook(() => useSessionPersistence({
      activeTabs: [agentTab], ephemeralConns: [agentConn],
      viewGroups: [{ ...baseGroup, panes: ['tab-agent', null, null, null, null, null, null, null] }],
      tabGroups: {}, activeGroupId: 'ungrouped', layoutMode: 1,
    }))
    await flushDebounce()

    const saved = loadSnapshot()
    expect(saved?.activeTabs[0].persistencePolicy).toBe('close-with-app')
    expect(saved?.ephemeralConns[0].initialCommand).toBe('claude --continue')
    expect(setPersistencePolicy).toHaveBeenCalledWith('tab-agent', 'close-with-app')
  })

  it('persists SSH terminals and keeps them in pane layout metadata', async () => {
    const sshConn = {
      id: 'ssh-1', name: 'SSH Host', type: 'SSH' as const,
      host: 'example.com', port: '22', user: 'admin',
    }
    const sshTab = { id: 'ssh-tab', connId: 'ssh-1', name: 'SSH Host' }
    renderHook(() => useSessionPersistence({
      activeTabs: [sshTab], ephemeralConns: [sshConn],
      viewGroups: [{ ...baseGroup, panes: ['ssh-tab', null, null, null, null, null, null, null] }],
      tabGroups: { 'ssh-tab': 'ungrouped' }, activeGroupId: 'ungrouped', layoutMode: 1,
    }))
    await flushDebounce()

    const saved = loadSnapshot()
    expect(saved?.activeTabs[0].id).toBe('ssh-tab')
    expect(saved?.ephemeralConns[0]).toMatchObject({ type: 'SSH', host: 'example.com', user: 'admin' })
    expect(saved?.viewGroups[0].panes[0]).toBe('ssh-tab')
    expect(saved?.tabGroups['ssh-tab']).toBe('ungrouped')
  })

  it('strips non-PTY tabs from pane arrays while retaining PTY tabs', async () => {
    const rdpConn = { id: 'rdp-1', name: 'Desktop', type: 'RDP' as const, host: 'desk', port: '3389', user: 'me' }
    const rdpTab = { id: 'rdp-tab', connId: 'rdp-1', name: 'Desktop' }
    renderHook(() => useSessionPersistence({
      activeTabs: [baseTab, rdpTab], ephemeralConns: [baseConn, rdpConn],
      viewGroups: [{ ...baseGroup, panes: ['tab-1', 'rdp-tab', null, null, null, null, null, null] }],
      tabGroups: {}, activeGroupId: 'ungrouped', layoutMode: 1,
    }))
    await flushDebounce()
    const saved = loadSnapshot()
    expect(saved?.viewGroups[0].panes[0]).toBe('tab-1')
    expect(saved?.viewGroups[0].panes[1]).toBeNull()
  })
})
