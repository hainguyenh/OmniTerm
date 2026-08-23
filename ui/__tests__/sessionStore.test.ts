import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SNAPSHOT_KEY,
  SNAPSHOT_VERSION,
  saveSnapshot,
  loadSnapshot,
  clearSnapshot,
  type SessionSnapshot,
} from '../utils/sessionStore'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    activeTabs: [{ id: 'tab-1', sessionId: 'tab-1', generation: 1, persistencePolicy: 'keep-running', connId: 'adhoc-1', name: 'PowerShell' }],
    ephemeralConns: [{ id: 'adhoc-1', name: 'PowerShell', type: 'LOCAL', shell: 'powershell' }],
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('sessionStore', () => {
  let storage: Record<string, string> = {}

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, val: string) => { storage[key] = val },
      removeItem: (key: string) => { delete storage[key] },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── saveSnapshot ──────────────────────────────────────────────────────────

  describe('saveSnapshot', () => {
    it('writes JSON to localStorage under the expected key', () => {
      const snap = makeSnapshot()
      saveSnapshot(snap)
      expect(storage[SNAPSHOT_KEY]).toBeDefined()
      const parsed = JSON.parse(storage[SNAPSHOT_KEY])
      expect(parsed.version).toBe(SNAPSHOT_VERSION)
      expect(parsed.activeTabs).toHaveLength(1)
    })

    it('silently ignores a localStorage error', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => null,
        setItem: () => { throw new Error('quota') },
        removeItem: () => {},
      })
      expect(() => saveSnapshot(makeSnapshot())).not.toThrow()
    })
  })

  // ── loadSnapshot ──────────────────────────────────────────────────────────

  describe('loadSnapshot', () => {
    it('returns null when nothing is stored', () => {
      expect(loadSnapshot()).toBeNull()
    })

    it('returns a valid snapshot when stored', () => {
      const snap = makeSnapshot()
      saveSnapshot(snap)
      const loaded = loadSnapshot()
      expect(loaded).not.toBeNull()
      expect(loaded?.version).toBe(SNAPSHOT_VERSION)
      expect(loaded?.activeTabs[0].id).toBe('tab-1')
    })

    it('returns null for corrupt JSON', () => {
      storage[SNAPSHOT_KEY] = '{invalid}'
      expect(loadSnapshot()).toBeNull()
    })

    it('returns null when version mismatches', () => {
      storage[SNAPSHOT_KEY] = JSON.stringify({ ...makeSnapshot(), version: 99 })
      expect(loadSnapshot()).toBeNull()
    })

    it('migrates a valid v1 snapshot instead of discarding it', () => {
      const v1 = {
        ...makeSnapshot(),
        version: 1,
        activeTabs: [{ id: 'agent-tab', connId: 'adhoc-1', name: 'Claude Code - repo' }],
        ephemeralConns: [{ id: 'adhoc-1', name: 'repo', shell: 'powershell' }],
      }
      storage[SNAPSHOT_KEY] = JSON.stringify(v1)
      const loaded = loadSnapshot()
      expect(loaded?.version).toBe(SNAPSHOT_VERSION)
      expect(loaded?.activeTabs[0]).toMatchObject({
        sessionId: 'agent-tab',
        generation: 1,
        persistencePolicy: 'close-with-app',
      })
    })

    it('returns null when activeTabs is missing a required field', () => {
      const bad = { ...makeSnapshot(), activeTabs: [{ id: 'x' }] }
      storage[SNAPSHOT_KEY] = JSON.stringify(bad)
      expect(loadSnapshot()).toBeNull()
    })

    it('returns null when viewGroup has invalid layoutMode', () => {
      const bad = makeSnapshot()
      bad.viewGroups[0].layoutMode = 9 as never
      storage[SNAPSHOT_KEY] = JSON.stringify(bad)
      expect(loadSnapshot()).toBeNull()
    })

    it('returns null when tabGroups contains a non-string value', () => {
      const bad = { ...makeSnapshot(), tabGroups: { 'tab-1': 42 } }
      storage[SNAPSHOT_KEY] = JSON.stringify(bad)
      expect(loadSnapshot()).toBeNull()
    })

    it('accepts all valid layout modes', () => {
      for (const mode of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
        const snap = makeSnapshot({ layoutMode: mode })
        saveSnapshot(snap)
        const loaded = loadSnapshot()
        expect(loaded?.layoutMode).toBe(mode)
      }
    })

    it('silently returns null on localStorage error', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => { throw new Error('denied') },
        setItem: () => {},
        removeItem: () => {},
      })
      expect(loadSnapshot()).toBeNull()
    })
  })

  // ── clearSnapshot ─────────────────────────────────────────────────────────

  describe('clearSnapshot', () => {
    it('removes the key from localStorage', () => {
      saveSnapshot(makeSnapshot())
      expect(storage[SNAPSHOT_KEY]).toBeDefined()
      clearSnapshot()
      expect(storage[SNAPSHOT_KEY]).toBeUndefined()
    })

    it('does not throw when nothing is stored', () => {
      expect(() => clearSnapshot()).not.toThrow()
    })
  })

  // ── Round-trip ────────────────────────────────────────────────────────────

  it('round-trips a multi-group snapshot faithfully', () => {
    const snap = makeSnapshot({
      activeTabs: [
        { id: 'tab-a', sessionId: 'tab-a', generation: 1, persistencePolicy: 'keep-running', connId: 'adhoc-a', name: 'Tab A' },
        { id: 'tab-b', sessionId: 'tab-b', generation: 1, persistencePolicy: 'keep-running', connId: 'adhoc-b', name: 'Tab B' },
      ],
      ephemeralConns: [
        { id: 'adhoc-a', name: 'Tab A', type: 'LOCAL', shell: 'cmd' },
        { id: 'adhoc-b', name: 'Tab B', type: 'LOCAL', shell: 'bash', workspaceId: 'ws-1' },
      ],
      viewGroups: [
        { id: 'ungrouped', label: 'Ungrouped', layoutMode: 1, panes: ['tab-a', null, null, null, null, null, null, null], focusedPane: 0 },
        { id: 'view-1', label: 'Desktop 1', layoutMode: 2, panes: ['tab-b', null, null, null, null, null, null, null], focusedPane: 0, color: '#ff0000' },
      ],
      tabGroups: { 'tab-b': 'view-1' },
      activeGroupId: 'view-1',
      layoutMode: 2,
    })
    saveSnapshot(snap)
    const loaded = loadSnapshot()
    expect(loaded?.viewGroups).toHaveLength(2)
    expect(loaded?.tabGroups['tab-b']).toBe('view-1')
    expect(loaded?.activeGroupId).toBe('view-1')
    expect(loaded?.ephemeralConns[1].workspaceId).toBe('ws-1')
  })

  it('persists and restores scrollbackKey and initialCommand in snapshot', () => {
    const snap = makeSnapshot({
      activeTabs: [
        {
          id: 'tab-agent',
          sessionId: 'tab-agent',
          generation: 3,
          persistencePolicy: 'recover-after-reboot',
          connId: 'adhoc-agent',
          name: 'claude: ~/project',
          scrollbackKey: 'sb-tab-agent',
        },
      ],
      ephemeralConns: [
        {
          id: 'adhoc-agent',
          name: 'Local Shell',
          localCwd: 'F:/repos/project',
          initialCommand: 'claude --continue',
        },
      ],
    })
    saveSnapshot(snap)
    const loaded = loadSnapshot()
    expect(loaded?.activeTabs[0].scrollbackKey).toBe('sb-tab-agent')
    expect(loaded?.ephemeralConns[0].initialCommand).toBe('claude --continue')
  })
})
