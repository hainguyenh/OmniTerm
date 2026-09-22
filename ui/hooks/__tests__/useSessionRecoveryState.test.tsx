/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { Connection } from '@omniterm/contract'
import type { LayoutMode } from '../../themes'
import type { ViewGroup } from '../../viewGroups'
import { SNAPSHOT_VERSION, type SessionSnapshot } from '../../utils/sessionStore'
import { useSessionRecoveryState } from '../useSessionRecoveryState'
import { useSessionPersistence } from '../useSessionPersistence'

vi.mock('../useSessionPersistence', () => ({ useSessionPersistence: vi.fn() }))

const snapshot: SessionSnapshot = {
  version: SNAPSHOT_VERSION,
  activeTabs: [
    {
      id: 'tab-a', connId: 'conn-a', name: 'A',
      recovery: { cwd: 'F:/a', cwdSource: 'reported', shell: 'powershell' },
    },
    {
      id: 'tab-b', connId: 'conn-b', name: 'B',
      recovery: { cwd: 'F:/b', cwdSource: 'reported', shell: 'powershell' },
    },
  ],
  ephemeralConns: [
    { id: 'conn-a', name: 'A', type: 'LOCAL', ephemeral: false, shell: 'powershell', localCwd: 'F:/a' },
    { id: 'conn-b', name: 'B', type: 'LOCAL', ephemeral: false, shell: 'powershell', localCwd: 'F:/b' },
  ],
  viewGroups: [{
    id: 'ungrouped', label: 'Ungrouped', layoutMode: 2,
    panes: ['tab-a', 'tab-b', null, null, null, null, null, null], focusedPane: 0,
  }],
  tabGroups: {},
  activeGroupId: 'ungrouped',
  layoutMode: 2,
  revision: 7,
}

function useHarness() {
  const [activeTabs, setActiveTabs] = useState<{ id: string; connId: string; name: string }[]>([])
  const [ephemeralConns, setEphemeralConns] = useState<Connection[]>([])
  const [viewGroups, setViewGroups] = useState<ViewGroup[]>([])
  const [tabGroups, setTabGroups] = useState<Record<string, string>>({})
  const [panes, setPanes] = useState<(string | null)[]>(Array(8).fill(null))
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(1)
  const [, setFocusedPane] = useState(0)
  const [, setResumeMode] = useState<Record<string, boolean>>({})
  const recovery = useSessionRecoveryState({
    activeTabs,
    ephemeralConns,
    resolveConnection: id => ephemeralConns.find(conn => conn.id === id),
    viewGroups,
    tabGroups,
    activeGroupId: 'ungrouped',
    layoutMode,
    sessionCwds: {},
    setActiveTabs,
    setEphemeralConns,
    setTabGroups,
    setResumeMode,
    restoreGroups: groups => setViewGroups(groups),
    setPanes,
    setLayoutMode,
    setFocusedPane,
  })
  return { recovery, activeTabs, panes }
}

describe('useSessionRecoveryState', () => {
  const open = vi.fn()
  const release = vi.fn()
  const localDisconnect = vi.fn()

  beforeEach(() => {
    vi.mocked(useSessionPersistence).mockReturnValue({ initialSnapshot: snapshot })
    open.mockReset().mockImplementation((_shell, _workspace, _folder, cwd) => Promise.resolve({
      id: cwd === 'F:/a' ? 'fresh-a' : 'fresh-b',
      name: cwd === 'F:/a' ? 'A' : 'B',
      type: 'LOCAL',
      host: '',
      port: '',
      user: '',
      shell: 'powershell',
      localCwd: cwd,
    } satisfies Connection))
    release.mockReset()
    localDisconnect.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(window, 'omnitermAPI', {
      configurable: true,
      value: {
        shells: { open, release },
        connect: { localDisconnect },
      },
    })
  })

  it('keeps successful registrations pending until native startup and can retry one while another pane is unresolved', async () => {
    open.mockImplementation((_shell, _workspace, _folder, cwd) => {
      if (cwd === 'F:/b') return Promise.reject(new Error('shell unavailable'))
      return Promise.resolve({
        id: 'fresh-a',
        name: 'A',
        type: 'LOCAL',
        host: '',
        port: '',
        user: '',
        shell: 'powershell',
        localCwd: cwd,
      } satisfies Connection)
    })

    const { result } = renderHook(() => useHarness())
    await vi.waitFor(() => {
      expect(result.current.recovery.restoreOutcomes['tab-a']?.phase).toBe('recovering')
      expect(result.current.recovery.restoreOutcomes['tab-b']?.phase).toBe('failed')
    })

    const latestPersistenceInput = () => vi.mocked(useSessionPersistence).mock.calls.at(-1)?.[0]
    await vi.waitFor(() => {
      expect(latestPersistenceInput()?.pendingSnapshot?.activeTabs.map(tab => tab.id)).toEqual(['tab-a', 'tab-b'])
    })

    act(() => result.current.recovery.markRestoreFailed('tab-a', 'native startup failed'))
    expect(result.current.recovery.restoreOutcomes['tab-a']?.phase).toBe('failed')

    const aCallsBefore = open.mock.calls.filter(call => call[3] === 'F:/a').length
    const bCallsBefore = open.mock.calls.filter(call => call[3] === 'F:/b').length
    act(() => result.current.recovery.retryRestore('tab-a'))
    await vi.waitFor(() => {
      expect(open.mock.calls.filter(call => call[3] === 'F:/a')).toHaveLength(aCallsBefore + 1)
    })
    expect(open.mock.calls.filter(call => call[3] === 'F:/b')).toHaveLength(bCallsBefore)

    act(() => result.current.recovery.markRestoreReady('tab-a'))
    await vi.waitFor(() => {
      expect(latestPersistenceInput()?.pendingSnapshot?.activeTabs.map(tab => tab.id)).toEqual(['tab-b'])
    })

    act(() => result.current.recovery.markRestoreFailed('tab-a'))
    expect(result.current.recovery.restoreOutcomes['tab-a']).toBeUndefined()
  })

  it('recreates saved panes as fresh shells in their saved directories', async () => {
    const { result } = renderHook(() => useHarness())

    await vi.waitFor(() => {
      expect(result.current.activeTabs).toEqual([
        { id: 'tab-a', connId: 'fresh-a', name: 'A' },
        { id: 'tab-b', connId: 'fresh-b', name: 'B' },
      ])
    })

    expect(localDisconnect).toHaveBeenCalledWith('tab-a')
    expect(localDisconnect).toHaveBeenCalledWith('tab-b')
    expect(open).toHaveBeenCalledWith('powershell', null, undefined, 'F:/a', null)
    expect(open).toHaveBeenCalledWith('powershell', null, undefined, 'F:/b', null)
    expect(result.current.panes.slice(0, 2)).toEqual(['tab-a', 'tab-b'])
    expect(result.current.recovery.restoreOutcomes['tab-a']?.phase).toBe('recovering')
    expect(result.current.recovery.restoreOutcomes['tab-b']?.phase).toBe('recovering')
  })
})
