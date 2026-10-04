/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'

import { useSessionPersistence } from '../useSessionPersistence'
import { loadSnapshot, SNAPSHOT_KEY, SNAPSHOT_VERSION, type SessionSnapshot } from '../../utils/sessionStore'
import { clearActiveForTab, findSessionByTabId, promoteStaleActiveSessions } from '../../utils/agentSessionStorage'
import { getPanePresence, isInRestoreGrace } from '../../utils/agentPresenceStore'
import { hydrateAgentSessionStore } from '../../utils/agentSessionDurable'
import type { ViewGroup } from '../../viewGroups'

vi.mock('../../utils/agentSessionDetector', () => ({
  detectPaneAgents: vi.fn(async () => []),
  resolveClaudeSessionId: vi.fn(async () => null),
}))

vi.mock('../../utils/agentSessionStorage', () => ({
  bindActiveSession: vi.fn(),
  clearActiveForTab: vi.fn(),
  findSessionByTabId: vi.fn(() => undefined),
  promoteStaleActiveSessions: vi.fn(),
}))

vi.mock('../../utils/agentSessionDurable', () => ({ hydrateAgentSessionStore: vi.fn(async () => {}) }))

vi.mock('../../utils/agentPresenceStore', () => ({
  getPanePresence: vi.fn(() => undefined),
  isInRestoreGrace: vi.fn(() => false),
  setPanePresence: vi.fn(),
}))

const findSessionMock = vi.mocked(findSessionByTabId)
const presenceMock = vi.mocked(getPanePresence)
const clearActiveMock = vi.mocked(clearActiveForTab)

const localConn = (overrides: Partial<Connection> = {}): Connection => ({
  id: 'conn-1',
  name: 'PowerShell',
  type: 'LOCAL',
  host: '',
  port: '',
  user: '',
  ...overrides,
})

const group = (overrides: Partial<ViewGroup> = {}): ViewGroup => ({
  id: 'ungrouped',
  label: 'Ungrouped',
  layoutMode: 1,
  panes: ['tab-1', null, null, null, null, null, null, null],
  focusedPane: 0,
  ...overrides,
})

const storedSnapshot = (overrides: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  version: SNAPSHOT_VERSION,
  activeTabs: [],
  ephemeralConns: [],
  viewGroups: [],
  tabGroups: {},
  activeGroupId: 'ungrouped',
  layoutMode: 1,
  revision: 0,
  ...overrides,
})

describe('useSessionPersistence snapshot building', () => {
  let storage: Record<string, string> = {}
  // `loadSnapshot` keeps only cwd/shell of a pane's recovery, so agent fields are read from the raw write.
  const rawSaved = (): SessionSnapshot => JSON.parse(storage[SNAPSHOT_KEY] ?? 'null')

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
      removeItem: (key: string) => { delete storage[key] },
    })
    findSessionMock.mockReset()
    presenceMock.mockReset()
    clearActiveMock.mockClear()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('promotes stale sessions and hydrates the durable store exactly once', () => {
    vi.mocked(promoteStaleActiveSessions).mockClear()
    vi.mocked(hydrateAgentSessionStore).mockClear()
    const { rerender } = renderHook(() => useSessionPersistence())
    rerender()
    expect(promoteStaleActiveSessions).toHaveBeenCalledTimes(1)
    expect(hydrateAgentSessionStore).toHaveBeenCalledTimes(1)
  })

  it('does not write anything before a terminal pane ever existed', () => {
    const rdp = localConn({ id: 'rdp', type: 'RDP' })
    renderHook(() => useSessionPersistence({
      activeTabs: [{ id: 'r', connId: 'rdp', name: 'Desktop' }, { id: 'x', connId: 'missing', name: 'Gone' }],
      ephemeralConns: [rdp],
    }))
    expect(storage[SNAPSHOT_KEY]).toBeUndefined()
  })

  it('continues the revision counter from the stored snapshot', () => {
    storage[SNAPSHOT_KEY] = JSON.stringify(storedSnapshot({ revision: 7 }))
    renderHook(() => useSessionPersistence({
      activeTabs: [{ id: 'tab-1', connId: 'conn-1', name: 'PowerShell' }],
      ephemeralConns: [localConn()],
    }))
    expect(loadSnapshot()?.revision).toBe(8)
  })

  it('saves a pending restore even before any live pane exists', () => {
    const pending = storedSnapshot({
      activeTabs: [{ id: 'old', connId: 'old-conn', name: 'Old', recovery: { cwdSource: 'unknown' } }],
      ephemeralConns: [{ id: 'old-conn', name: 'Old', type: 'LOCAL', ephemeral: true }],
    })
    renderHook(() => useSessionPersistence({ pendingSnapshot: pending }))
    expect(loadSnapshot()?.activeTabs.map(tab => tab.id)).toEqual(['old'])
  })

  it('records the stored agent session for a pane', () => {
    findSessionMock.mockReturnValue({
      id: 'claude:s-1',
      agent: 'claude',
      sessionId: 's-1',
      profileName: 'work',
      launcher: 'claude-work',
      state: 'active',
      updatedAt: 1,
    })
    renderHook(() => useSessionPersistence({
      activeTabs: [{ id: 'tab-1', connId: 'conn-1', name: 'pwsh' }],
      ephemeralConns: [localConn()],
    }))
    expect(rawSaved().activeTabs[0].recovery).toEqual({
      cwdSource: 'unknown',
      agent: 'claude',
      agentSessionId: 's-1',
      profileName: 'work',
      launcher: 'claude-work',
    })
  })

  it('falls back to live presence, preferring the generic session id over the Claude one', () => {
    presenceMock.mockImplementation((tabId) => tabId === 'a'
      ? { agent: 'codex', profileName: 'home', launcher: 'codex-home', pid: 1, startTime: 1, agentSessionId: 'gen', claudeSessionId: 'cl' }
      : { agent: 'claude', profileName: 'claude', pid: 2, startTime: 2, claudeSessionId: 'only-claude' })
    renderHook(() => useSessionPersistence({
      activeTabs: [{ id: 'a', connId: 'conn-1', name: 'pwsh' }, { id: 'b', connId: 'conn-1', name: 'pwsh' }],
      ephemeralConns: [localConn({ shell: 'powershell', localCwd: 'C:/launch' })],
    }))
    const tabs = rawSaved().activeTabs
    expect(tabs[0].recovery).toEqual({
      cwd: 'C:/launch',
      cwdSource: 'launch',
      shell: 'powershell',
      agent: 'codex',
      agentSessionId: 'gen',
      profileName: 'home',
      launcher: 'codex-home',
    })
    expect(tabs[1].recovery).toMatchObject({ agent: 'claude', agentSessionId: 'only-claude', profileName: 'claude' })
    expect(tabs[1].recovery).not.toHaveProperty('launcher')
  })

  it('names the agent from the pane title when nothing was detected', () => {
    renderHook(() => useSessionPersistence({
      activeTabs: [{ id: 'tab-1', connId: 'conn-1', name: 'Claude Code' }],
      ephemeralConns: [localConn()],
    }))
    expect(rawSaved().activeTabs[0].recovery).toEqual({ cwdSource: 'unknown', agent: 'Claude Code' })
  })

  it('persists each connection once, marking resolved saved connections as non-ephemeral', () => {
    const saved = localConn({ id: 'saved', name: 'Saved', type: 'SSH', host: 'h', port: '2222', user: 'u', workspaceId: 'ws' })
    const resolveConnection = (id?: string) => (id === 'saved' ? saved : undefined)
    renderHook(() => useSessionPersistence({
      activeTabs: [
        { id: 'tab-1', connId: 'conn-1', name: 'One' },
        { id: 'tab-2', connId: 'conn-1', name: 'Two' },
        { id: 'tab-3', connId: 'saved', name: 'Three' },
      ],
      ephemeralConns: [localConn({ localCwd: 'C:/x', shell: 'cmd' })],
      resolveConnection,
      tabGroups: { 'tab-1': 'g1', 'gone-tab': 'g1' },
      activeGroupId: 'g1',
      viewGroups: [
        group({ id: 'g1', color: '#fff', persistent: false, panes: ['tab-1', 'gone-tab', null] }),
        group({ id: 'g2' }),
      ],
      layoutMode: 2,
    }))
    const snapshot = loadSnapshot()
    expect(snapshot?.ephemeralConns).toEqual([
      { id: 'conn-1', name: 'PowerShell', type: 'LOCAL', ephemeral: true, shell: 'cmd', localCwd: 'C:/x' },
      { id: 'saved', name: 'Saved', type: 'SSH', ephemeral: false, workspaceId: 'ws', host: 'h', port: '2222', user: 'u' },
    ])
    expect(snapshot?.tabGroups).toEqual({ 'tab-1': 'g1' })
    expect(snapshot?.activeGroupId).toBe('g1')
    expect(snapshot?.layoutMode).toBe(2)
    expect(snapshot?.viewGroups[0]).toMatchObject({ color: '#fff', persistent: false, panes: ['tab-1', null, null] })
    expect(snapshot?.viewGroups[1]).not.toHaveProperty('color')
    expect(snapshot?.viewGroups[1]).not.toHaveProperty('persistent')
  })

  it('checkpoints again on beforeunload and stops listening after unmount', () => {
    const { unmount } = renderHook(() => useSessionPersistence({
      activeTabs: [{ id: 'tab-1', connId: 'conn-1', name: 'PowerShell' }],
      ephemeralConns: [localConn()],
    }))
    const first = loadSnapshot()?.revision ?? 0
    act(() => { window.dispatchEvent(new Event('beforeunload')) })
    expect(loadSnapshot()?.revision).toBe(first + 1)
    unmount()
    act(() => { window.dispatchEvent(new Event('beforeunload')) })
    expect(loadSnapshot()?.revision).toBe(first + 1)
  })

  it('ends session tracking for a tab as soon as it closes', () => {
    const tabA = { id: 'a', connId: 'conn-1', name: 'A' }
    const tabB = { id: 'b', connId: 'conn-1', name: 'B' }
    const conns = [localConn()]
    // Spare both panes from the poll's own untracking so only the close path clears them.
    vi.mocked(isInRestoreGrace).mockReturnValue(true)
    const { rerender } = renderHook(({ tabs }) => useSessionPersistence({ activeTabs: tabs, ephemeralConns: conns }), {
      initialProps: { tabs: [tabA, tabB] },
    })
    expect(clearActiveMock).not.toHaveBeenCalled()
    rerender({ tabs: [tabB] })
    expect(clearActiveMock).toHaveBeenCalledWith('a')
    expect(clearActiveMock).not.toHaveBeenCalledWith('b')
    vi.mocked(isInRestoreGrace).mockReturnValue(false)
  })
})
