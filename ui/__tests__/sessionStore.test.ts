import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SNAPSHOT_KEY,
  SNAPSHOT_VERSION,
  clearSnapshot,
  loadSnapshot,
  saveSnapshot,
  type SessionSnapshot,
} from '../utils/sessionStore'

function makeSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    activeTabs: [{
      id: 'tab-1',
      connId: 'adhoc-1',
      name: 'PowerShell',
      recovery: { cwd: 'F:/repo', cwdSource: 'reported', shell: 'powershell' },
    }],
    ephemeralConns: [{
      id: 'adhoc-1',
      name: 'PowerShell',
      type: 'LOCAL',
      ephemeral: true,
      shell: 'powershell',
      localCwd: 'F:/repo',
    }],
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

describe('sessionStore', () => {
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

  it('round-trips pane layout, connection metadata, and cwd', () => {
    const snapshot = makeSnapshot({
      viewGroups: [
        { id: 'ungrouped', label: 'Ungrouped', layoutMode: 1, panes: ['tab-1', null, null, null, null, null, null, null], focusedPane: 0 },
        { id: 'view-1', label: 'Desktop 1', layoutMode: 2, panes: [null, 'tab-1', null, null, null, null, null, null], focusedPane: 1, color: '#ff0000' },
      ],
      tabGroups: { 'tab-1': 'view-1' },
      activeGroupId: 'view-1',
      layoutMode: 2,
      revision: 9,
    })
    saveSnapshot(snapshot)

    const loaded = loadSnapshot()
    expect(loaded).toEqual(snapshot)
    expect(JSON.parse(storage[SNAPSHOT_KEY]).activeTabs[0]).toEqual({
      id: 'tab-1',
      connId: 'adhoc-1',
      name: 'PowerShell',
      recovery: { cwd: 'F:/repo', cwdSource: 'reported', shell: 'powershell' },
    })
  })

  it('migrates v1-v3 while dropping process persistence, scrollback, and command metadata', () => {
    for (const version of [1, 2, 3] as const) {
      storage[SNAPSHOT_KEY] = JSON.stringify({
        ...makeSnapshot(),
        version,
        revision: version === 3 ? 7 : undefined,
        activeTabs: [{
          id: 'legacy-tab',
          sessionId: 'daemon-session',
          generation: 12,
          persistencePolicy: 'recover-after-reboot',
          scrollbackKey: 'sb-legacy',
          connId: 'adhoc-1',
          name: 'Legacy',
          recovery: {
            cwd: 'F:/legacy',
            cwdSource: 'reported',
            shell: 'powershell',
            recipe: { kind: 'manual', reason: 'identity-unavailable' },
          },
        }],
        ephemeralConns: [{
          id: 'adhoc-1',
          name: 'Legacy',
          type: 'LOCAL',
          shell: 'powershell',
          localCwd: 'F:/legacy',
          initialCommand: 'claude --continue',
        }],
      })

      const loaded = loadSnapshot()
      expect(loaded?.version).toBe(SNAPSHOT_VERSION)
      expect(loaded?.activeTabs[0]).toEqual({
        id: 'legacy-tab',
        connId: 'adhoc-1',
        name: 'Legacy',
        recovery: { cwd: 'F:/legacy', cwdSource: 'reported', shell: 'powershell' },
      })
      expect(loaded?.ephemeralConns[0]).not.toHaveProperty('initialCommand')
      expect(loaded?.activeTabs[0]).not.toHaveProperty('persistencePolicy')
      expect(loaded?.activeTabs[0]).not.toHaveProperty('generation')
      expect(loaded?.activeTabs[0]).not.toHaveProperty('scrollbackKey')
    }
  })

  it('derives cwd and shell for legacy snapshots without recovery metadata', () => {
    storage[SNAPSHOT_KEY] = JSON.stringify({
      ...makeSnapshot(),
      version: 1,
      activeTabs: [{ id: 'legacy-tab', connId: 'adhoc-1', name: 'Legacy' }],
    })

    expect(loadSnapshot()?.activeTabs[0].recovery).toEqual({
      cwd: 'F:/repo',
      cwdSource: 'launch',
      shell: 'powershell',
    })
  })

  it('rejects malformed current snapshots and unsupported versions', () => {
    storage[SNAPSHOT_KEY] = JSON.stringify({ ...makeSnapshot(), version: 99 })
    expect(loadSnapshot()).toBeNull()

    storage[SNAPSHOT_KEY] = JSON.stringify({ ...makeSnapshot(), activeTabs: [{ id: 'x' }] })
    expect(loadSnapshot()).toBeNull()

    const badMode = makeSnapshot()
    badMode.viewGroups[0].layoutMode = 9 as never
    storage[SNAPSHOT_KEY] = JSON.stringify(badMode)
    expect(loadSnapshot()).toBeNull()
  })

  it('accepts every supported layout mode', () => {
    for (const mode of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      saveSnapshot(makeSnapshot({ layoutMode: mode }))
      expect(loadSnapshot()?.layoutMode).toBe(mode)
    }
  })

  it('treats storage failures as optional', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('denied') },
    })
    expect(() => saveSnapshot(makeSnapshot())).not.toThrow()
    expect(loadSnapshot()).toBeNull()
    expect(() => clearSnapshot()).not.toThrow()
  })

  it('clears the snapshot key', () => {
    saveSnapshot(makeSnapshot())
    expect(storage[SNAPSHOT_KEY]).toBeDefined()
    clearSnapshot()
    expect(storage[SNAPSHOT_KEY]).toBeUndefined()
  })
})
