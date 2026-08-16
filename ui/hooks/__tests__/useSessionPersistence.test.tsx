/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSessionPersistence } from '../useSessionPersistence'
import { loadSnapshot, SNAPSHOT_KEY, SNAPSHOT_VERSION } from '../../utils/sessionStore'
import type { SessionSnapshot } from '../../utils/sessionStore'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStoredSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    activeTabs: [{ id: 'tab-1', connId: 'adhoc-1', name: 'PowerShell' }],
    ephemeralConns: [{ id: 'adhoc-1', name: 'PowerShell', shell: 'powershell' }],
    viewGroups: [
      {
        id: 'ungrouped',
        label: 'Ungrouped',
        layoutMode: 1,
        panes: ['tab-1', null, null, null, null, null, null, null],
        focusedPane: 0,
        persistent: true,
      },
    ],
    tabGroups: {},
    activeGroupId: 'ungrouped',
    layoutMode: 1,
    ...overrides,
  }
}

const baseConn = { id: 'adhoc-1', name: 'PowerShell', type: 'LOCAL' as const, host: '', port: '', user: '', shell: 'powershell' as const }
const baseTab = { id: 'tab-1', connId: 'adhoc-1', name: 'PowerShell' }
const baseGroup = { id: 'ungrouped', label: 'Ungrouped', layoutMode: 1 as const, panes: ['tab-1', null, null, null, null, null, null, null] as (string|null)[], focusedPane: 0, persistent: true as const }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useSessionPersistence', () => {
  let storage: Record<string, string> = {}

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, val: string) => { storage[key] = val },
      removeItem: (key: string) => { delete storage[key] },
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('returns null initialSnapshot when no snapshot is stored', () => {
    const { result } = renderHook(() =>
      useSessionPersistence({
        activeTabs: [],
        ephemeralConns: [],
        viewGroups: [baseGroup],
        tabGroups: {},
        activeGroupId: 'ungrouped',
        layoutMode: 1,
      }),
    )
    expect(result.current.initialSnapshot).toBeNull()
  })

  it('returns the stored snapshot as initialSnapshot', () => {
    const snap = makeStoredSnapshot()
    storage[SNAPSHOT_KEY] = JSON.stringify(snap)

    const { result } = renderHook(() =>
      useSessionPersistence({
        activeTabs: [baseTab],
        ephemeralConns: [baseConn],
        viewGroups: [baseGroup],
        tabGroups: {},
        activeGroupId: 'ungrouped',
        layoutMode: 1,
      }),
    )
    expect(result.current.initialSnapshot?.version).toBe(SNAPSHOT_VERSION)
    expect(result.current.initialSnapshot?.activeTabs[0].id).toBe('tab-1')
  })

  it('writes a snapshot after the debounce delay when local sessions exist', () => {
    renderHook(() =>
      useSessionPersistence({
        activeTabs: [baseTab],
        ephemeralConns: [baseConn],
        viewGroups: [baseGroup],
        tabGroups: {},
        activeGroupId: 'ungrouped',
        layoutMode: 1,
      }),
    )

    expect(storage[SNAPSHOT_KEY]).toBeUndefined()
    act(() => { vi.runAllTimers() })
    expect(storage[SNAPSHOT_KEY]).toBeDefined()

    const written = loadSnapshot()
    expect(written?.activeTabs[0].id).toBe('tab-1')
    expect(written?.ephemeralConns[0].shell).toBe('powershell')
  })

  it('persists agentContext and initialCommand for active AI agent tabs', () => {
    const agentConn = { id: 'adhoc-agent', name: 'claude', type: 'LOCAL' as const, host: '', port: '', user: '', shell: 'powershell' as const, localCwd: 'F:/repo' }
    const agentTab = { id: 'tab-agent', connId: 'adhoc-agent', name: 'claude: ~/repo' }

    renderHook(() =>
      useSessionPersistence({
        activeTabs: [agentTab],
        ephemeralConns: [agentConn],
        viewGroups: [baseGroup],
        tabGroups: {},
        activeGroupId: 'ungrouped',
        layoutMode: 1,
      }),
    )

    act(() => { vi.runAllTimers() })
    const saved = loadSnapshot()
    expect(saved?.activeTabs[0].scrollbackKey).toBe('sb-tab-agent')
    expect(saved?.ephemeralConns[0].initialCommand).toBe('claude --resume')
  })

  it('does not write a snapshot when there are no local connections', () => {
    const sshConn = { id: 'ssh-1', name: 'SSH Host', type: 'SSH' as const, host: 'example.com', port: '22', user: 'admin' }
    const sshTab = { id: 'ssh-1', connId: 'ssh-1', name: 'SSH Host' }
    renderHook(() =>
      useSessionPersistence({
        activeTabs: [sshTab],
        ephemeralConns: [sshConn],
        viewGroups: [{ ...baseGroup, panes: ['ssh-1', null, null, null, null, null, null, null] }],
        tabGroups: {},
        activeGroupId: 'ungrouped',
        layoutMode: 1,
      }),
    )

    act(() => { vi.runAllTimers() })
    expect(storage[SNAPSHOT_KEY]).toBeUndefined()
  })

  it('does not overwrite an already-stored snapshot while the layout is empty', () => {
    // The startup window: a stored snapshot exists (restore has not consumed it yet) and
    // the live layout is still empty. Wiping it here would lose the crash-recovery session.
    storage[SNAPSHOT_KEY] = JSON.stringify(makeStoredSnapshot())
    renderHook(() =>
      useSessionPersistence({
        activeTabs: [],
        ephemeralConns: [],
        viewGroups: [],
        tabGroups: {},
        activeGroupId: 'ungrouped',
        layoutMode: 1,
      }),
    )

    act(() => { vi.runAllTimers() })
    const kept = loadSnapshot()
    expect(kept?.activeTabs[0].id).toBe('tab-1')
  })

  it('strips SSH tabs from pane arrays before saving', () => {
    const sshConn = { id: 'ssh-1', name: 'SSH Host', type: 'SSH' as const, host: 'example.com', port: '22', user: 'admin' }
    const sshTab = { id: 'ssh-tab', connId: 'ssh-1', name: 'SSH Host' }
    const mixedGroup = {
      ...baseGroup,
      panes: ['tab-1', 'ssh-tab', null, null, null, null, null, null] as (string|null)[],
    }

    renderHook(() =>
      useSessionPersistence({
        activeTabs: [baseTab, sshTab],
        ephemeralConns: [baseConn, sshConn],
        viewGroups: [mixedGroup],
        tabGroups: {},
        activeGroupId: 'ungrouped',
        layoutMode: 1,
      }),
    )

    act(() => { vi.runAllTimers() })
    const saved = loadSnapshot()
    // 'ssh-tab' must be nulled out; 'tab-1' stays
    expect(saved?.viewGroups[0].panes[0]).toBe('tab-1')
    expect(saved?.viewGroups[0].panes[1]).toBeNull()
  })

  it('keeps initialSnapshot stable across re-renders', () => {
    const snap = makeStoredSnapshot()
    storage[SNAPSHOT_KEY] = JSON.stringify(snap)

    const { result, rerender } = renderHook(() =>
      useSessionPersistence({
        activeTabs: [baseTab],
        ephemeralConns: [baseConn],
        viewGroups: [baseGroup],
        tabGroups: {},
        activeGroupId: 'ungrouped',
        layoutMode: 1,
      }),
    )
    const first = result.current.initialSnapshot
    rerender()
    expect(result.current.initialSnapshot).toBe(first)
  })
})
