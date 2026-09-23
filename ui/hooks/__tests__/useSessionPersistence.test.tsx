/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSessionPersistence } from '../useSessionPersistence'
import { loadSnapshot, SNAPSHOT_KEY, SNAPSHOT_VERSION, type SessionSnapshot } from '../../utils/sessionStore'

function makeStoredSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    activeTabs: [{
      id: 'tab-1',
      connId: 'adhoc-1',
      name: 'PowerShell',
      recovery: { cwdSource: 'unknown', shell: 'powershell' },
    }],
    ephemeralConns: [{ id: 'adhoc-1', name: 'PowerShell', type: 'LOCAL', ephemeral: true, shell: 'powershell' }],
    viewGroups: [{
      id: 'ungrouped',
      label: 'Ungrouped',
      layoutMode: 1,
      panes: ['tab-1', null, null, null, null, null, null, null],
      focusedPane: 0,
      persistent: true,
    }],
    tabGroups: {},
    activeGroupId: 'ungrouped',
    layoutMode: 1,
    revision: 0,
    ...overrides,
  }
}

const baseConn = {
  id: 'adhoc-1',
  name: 'PowerShell',
  type: 'LOCAL' as const,
  host: '',
  port: '',
  user: '',
  shell: 'powershell' as const,
  localCwd: 'F:/launch',
}
const baseTab = { id: 'tab-1', connId: 'adhoc-1', name: 'PowerShell' }
const baseGroup = {
  id: 'ungrouped',
  label: 'Ungrouped',
  layoutMode: 1 as const,
  panes: ['tab-1', null, null, null, null, null, null, null] as (string | null)[],
  focusedPane: 0,
  persistent: true as const,
}

describe('useSessionPersistence', () => {
  let storage: Record<string, string> = {}

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
      removeItem: (key: string) => { delete storage[key] },
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('loads the initial snapshot once and does not overwrite it before hydration', () => {
    storage[SNAPSHOT_KEY] = JSON.stringify(makeStoredSnapshot())
    const { result, rerender } = renderHook(() => useSessionPersistence({
      activeTabs: [],
      ephemeralConns: [],
      viewGroups: [],
      tabGroups: {},
      activeGroupId: 'ungrouped',
      layoutMode: 1,
    }))
    const first = result.current.initialSnapshot
    rerender()
    expect(result.current.initialSnapshot).toBe(first)
    expect(loadSnapshot()?.activeTabs[0].id).toBe('tab-1')
  })

  it('checkpoints a new pane immediately with only reconstruction metadata', () => {
    renderHook(() => useSessionPersistence({
      activeTabs: [baseTab],
      ephemeralConns: [baseConn],
      viewGroups: [baseGroup],
      tabGroups: {},
      activeGroupId: 'ungrouped',
      layoutMode: 1,
      sessionCwds: { 'tab-1': 'F:/current' },
    }))

    const saved = loadSnapshot()
    expect(saved?.activeTabs[0]).toEqual({
      id: 'tab-1',
      connId: 'adhoc-1',
      name: 'PowerShell',
      recovery: { cwd: 'F:/current', cwdSource: 'reported', shell: 'powershell' },
    })
    expect(saved?.activeTabs[0]).not.toHaveProperty('persistencePolicy')
    expect(saved?.activeTabs[0]).not.toHaveProperty('scrollbackKey')
  })

  it('uses launch cwd until the terminal reports a newer cwd', () => {
    const { rerender } = renderHook(({ cwd }: { cwd?: string }) => useSessionPersistence({
      activeTabs: [baseTab],
      ephemeralConns: [baseConn],
      viewGroups: [baseGroup],
      tabGroups: {},
      activeGroupId: 'ungrouped',
      layoutMode: 1,
      sessionCwds: cwd ? { 'tab-1': cwd } : {},
    }), { initialProps: {} as { cwd?: string } })

    expect(loadSnapshot()?.activeTabs[0].recovery).toMatchObject({ cwd: 'F:/launch', cwdSource: 'launch' })
    rerender({ cwd: 'F:/current' })
    expect(loadSnapshot()?.activeTabs[0].recovery).toMatchObject({ cwd: 'F:/current', cwdSource: 'reported' })
  })

  it('persists an empty hydrated layout after the final terminal closes', () => {
    const { rerender } = renderHook((tabs: typeof baseTab[]) => useSessionPersistence({
      activeTabs: tabs,
      ephemeralConns: tabs.length ? [baseConn] : [],
      viewGroups: tabs.length ? [baseGroup] : [],
      tabGroups: {},
      activeGroupId: 'ungrouped',
      layoutMode: 1,
    }), { initialProps: [baseTab] })

    rerender([])
    expect(loadSnapshot()?.activeTabs).toEqual([])
  })

  it('merges unresolved restore entries into the latest checkpoint', () => {
    const pending = makeStoredSnapshot({
      activeTabs: [{
        id: 'tab-pending',
        connId: 'adhoc-pending',
        name: 'Pending',
        recovery: { cwd: 'F:/pending', cwdSource: 'reported', shell: 'powershell' },
      }],
      ephemeralConns: [{ id: 'adhoc-pending', name: 'Pending', type: 'LOCAL', ephemeral: true }],
      viewGroups: [{
        id: 'ungrouped',
        label: 'Ungrouped',
        layoutMode: 2,
        panes: [null, 'tab-pending', null, null, null, null, null, null],
        focusedPane: 1,
      }],
      layoutMode: 2,
    })

    renderHook(() => useSessionPersistence({
      activeTabs: [baseTab],
      ephemeralConns: [baseConn],
      viewGroups: [baseGroup],
      tabGroups: {},
      activeGroupId: 'ungrouped',
      layoutMode: 2,
      pendingSnapshot: pending,
    }))

    expect(loadSnapshot()?.activeTabs.map(tab => tab.id)).toEqual(['tab-1', 'tab-pending'])
    expect(loadSnapshot()?.viewGroups[0].panes.slice(0, 2)).toEqual(['tab-1', 'tab-pending'])
  })

  it('flushes the latest pane layout on pagehide', () => {
    const { rerender } = renderHook((group: typeof baseGroup) => useSessionPersistence({
      activeTabs: [baseTab],
      ephemeralConns: [baseConn],
      viewGroups: [group],
      tabGroups: {},
      activeGroupId: 'ungrouped',
      layoutMode: 1,
    }), { initialProps: baseGroup })

    rerender({ ...baseGroup, panes: [null, 'tab-1', null, null, null, null, null, null] })
    window.dispatchEvent(new Event('pagehide'))
    expect(loadSnapshot()?.viewGroups[0].panes[1]).toBe('tab-1')
  })

  it('keeps SSH metadata and strips non-terminal panes', () => {
    const sshConn = { id: 'ssh-1', name: 'SSH Host', type: 'SSH' as const, host: 'example.com', port: '22', user: 'admin' }
    const rdpConn = { id: 'rdp-1', name: 'Desktop', type: 'RDP' as const, host: 'desk', port: '3389', user: 'me' }
    renderHook(() => useSessionPersistence({
      activeTabs: [
        { id: 'ssh-tab', connId: 'ssh-1', name: 'SSH Host' },
        { id: 'rdp-tab', connId: 'rdp-1', name: 'Desktop' },
      ],
      ephemeralConns: [sshConn, rdpConn],
      viewGroups: [{ ...baseGroup, panes: ['ssh-tab', 'rdp-tab', null, null, null, null, null, null] }],
      tabGroups: { 'ssh-tab': 'ungrouped' },
      activeGroupId: 'ungrouped',
      layoutMode: 2,
    }))

    const saved = loadSnapshot()
    expect(saved?.activeTabs.map(tab => tab.id)).toEqual(['ssh-tab'])
    expect(saved?.ephemeralConns[0]).toMatchObject({ type: 'SSH', host: 'example.com', user: 'admin' })
    expect(saved?.viewGroups[0].panes.slice(0, 2)).toEqual(['ssh-tab', null])
  })
})
