/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearSnapshot, loadSnapshot, saveSnapshot, SNAPSHOT_KEY, SNAPSHOT_VERSION } from '../sessionStore'

const group = (over: Record<string, unknown> = {}) => ({
  id: 'ungrouped', label: 'Ungrouped', layoutMode: 2, panes: ['t1', null], focusedPane: 0, ...over,
})

const snapshot = (over: Record<string, unknown> = {}) => ({
  version: SNAPSHOT_VERSION,
  activeTabs: [{ id: 't1', connId: 'c1', name: 'one', recovery: { cwd: 'C:/a', cwdSource: 'reported' } }],
  ephemeralConns: [{ id: 'c1', name: 'shell' }],
  viewGroups: [group()],
  tabGroups: {},
  activeGroupId: 'ungrouped',
  layoutMode: 2,
  revision: 3,
  ...over,
})

function store(value: unknown) {
  localStorage.setItem(SNAPSHOT_KEY, typeof value === 'string' ? value : JSON.stringify(value))
}

describe('sessionStore', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('round-trips a current snapshot', () => {
    saveSnapshot(snapshot() as never)
    expect(loadSnapshot()).toEqual(snapshot())
    clearSnapshot()
    expect(loadSnapshot()).toBeNull()
  })

  it('treats missing, broken or non-object storage as no snapshot', () => {
    expect(loadSnapshot()).toBeNull()
    store('not json')
    expect(loadSnapshot()).toBeNull()
    for (const value of [null, 4, [], 'x']) {
      store(value)
      expect(loadSnapshot()).toBeNull()
    }
  })

  it('rejects unknown versions and malformed top-level fields', () => {
    const bad: Array<Record<string, unknown>> = [
      { version: 9 },
      { activeTabs: 'x' },
      { ephemeralConns: null },
      { viewGroups: {} },
      { viewGroups: [group({ id: 4 })] },
      { viewGroups: [group({ label: 4 })] },
      { viewGroups: [group({ layoutMode: 99 })] },
      { viewGroups: [group({ panes: 'x' })] },
      { viewGroups: [group({ panes: [4] })] },
      { viewGroups: [group({ focusedPane: 1.5 })] },
      { viewGroups: [null] },
      { tabGroups: [] },
      { tabGroups: { a: 4 } },
      { tabGroups: null },
      { activeGroupId: 4 },
      { layoutMode: 0 },
      { revision: -1 },
      { revision: 1.5 },
    ]
    for (const over of bad) {
      store(snapshot(over))
      expect(loadSnapshot(), JSON.stringify(over)).toBeNull()
    }
  })

  it('rejects malformed connections', () => {
    const bad: unknown[] = [
      null, [], { id: 1, name: 'x' }, { id: 'a', name: 4 }, { id: 'a', name: 'x', type: 'RDP' },
      { id: 'a', name: 'x', ephemeral: 'yes' }, { id: 'a', name: 'x', shell: 4 }, { id: 'a', name: 'x', port: 22 },
    ]
    for (const conn of bad) {
      store(snapshot({ ephemeralConns: [conn] }))
      expect(loadSnapshot()).toBeNull()
    }
  })

  it('keeps every optional connection field it understands', () => {
    const conn = {
      id: 'c1', name: 'n', type: 'SSH', ephemeral: true, shell: 'bash', workspaceId: 'w', localCwd: 'C:/x', host: 'h', port: '22', user: 'u',
    }
    store(snapshot({ ephemeralConns: [conn] }))
    expect(loadSnapshot()?.ephemeralConns).toEqual([conn])
  })

  it('rejects malformed tabs and, in the current version, tabs without a valid recovery context', () => {
    for (const tab of [null, [], { id: 1, connId: 'c', name: 'n' }, { id: 't', connId: 2, name: 'n' }, { id: 't', connId: 'c', name: 4 }]) {
      store(snapshot({ activeTabs: [tab] }))
      expect(loadSnapshot()).toBeNull()
    }
    for (const recovery of [undefined, [], { cwdSource: 'nope' }, { cwdSource: 'launch', cwd: 4 }, { cwdSource: 'launch', shell: 4 }]) {
      store(snapshot({ activeTabs: [{ id: 't', connId: 'c', name: 'n', recovery }] }))
      expect(loadSnapshot()).toBeNull()
    }
  })

  it('keeps well-formed agent details field by field and drops malformed ones', () => {
    const recovery = {
      cwdSource: 'reported', cwd: 'C:/a', shell: 'pwsh', agent: 'claude', agentSessionId: 4, profileName: 'work', launcher: '',
    }
    store(snapshot({ activeTabs: [{ id: 't', connId: 'c', name: 'n', recovery }] }))
    expect(loadSnapshot()?.activeTabs[0]?.recovery).toEqual({
      cwdSource: 'reported', cwd: 'C:/a', shell: 'pwsh', agent: 'claude', profileName: 'work',
    })
  })

  it('upgrades a version 1 snapshot, filling recovery from the connection', () => {
    store({
      version: 1,
      activeTabs: [
        { id: 't1', connId: 'c1', name: 'one' },
        { id: 't2', connId: 'missing', name: 'two', recovery: { cwd: 'C:/legacy', shell: 'zsh', cwdSource: 'reported' } },
        { id: 't3', connId: 'missing', name: 'three', recovery: { cwdSource: 'bogus' } },
        { id: 't4', connId: 'c1', name: 'four', recovery: { cwd: 4, shell: 4 } },
      ],
      ephemeralConns: [{ id: 'c1', name: 'shell', localCwd: 'C:/conn', shell: 'bash' }],
      viewGroups: [group()],
      tabGroups: {},
      activeGroupId: 'ungrouped',
      layoutMode: 2,
    })
    const loaded = loadSnapshot()!
    expect(loaded.version).toBe(SNAPSHOT_VERSION)
    expect(loaded.revision).toBe(0)
    const [t1, t2, t3, t4] = loaded.activeTabs.map((tab) => tab.recovery)
    expect(t1).toEqual({ cwd: 'C:/conn', cwdSource: 'launch', shell: 'bash' })
    expect(t2).toEqual({ cwd: 'C:/legacy', cwdSource: 'reported', shell: 'zsh' })
    expect(t3).toEqual({ cwdSource: 'unknown' })
    expect(t4).toEqual({ cwd: 'C:/conn', cwdSource: 'launch', shell: 'bash' })
  })

  it('reads the revision of a version 3 snapshot but not of version 2', () => {
    const base = { activeTabs: [], ephemeralConns: [], viewGroups: [group()], tabGroups: {}, activeGroupId: 'ungrouped', layoutMode: 2 }
    store({ ...base, version: 3, revision: 7 })
    expect(loadSnapshot()?.revision).toBe(7)
    store({ ...base, version: 2, revision: 7 })
    expect(loadSnapshot()?.revision).toBe(0)
    store({ ...base, version: 3, revision: 'x' })
    expect(loadSnapshot()).toBeNull()
  })

  it('keeps optional group fields and copies the pane list', () => {
    store(snapshot({ viewGroups: [group({ color: '#fff', persistent: true })] }))
    expect(loadSnapshot()?.viewGroups[0]).toMatchObject({ color: '#fff', persistent: true })
  })

  it('folds desktop groups into the single pane grid', () => {
    store(snapshot({
      viewGroups: [
        group({ panes: [null, null] }),
        group({ id: 'dev', label: 'Dev', layoutMode: 4, panes: ['t1', 't2', null, null], focusedPane: 9 }),
      ],
      tabGroups: { t1: 'dev' },
      activeGroupId: 'dev',
      layoutMode: 2,
    }))
    const loaded = loadSnapshot()!
    expect(loaded.viewGroups).toHaveLength(1)
    expect(loaded.viewGroups[0]).toMatchObject({ id: 'ungrouped', layoutMode: 4, panes: ['t1', 't2', null, null], focusedPane: 3 })
    expect(loaded.activeGroupId).toBe('ungrouped')
    expect(loaded.tabGroups).toEqual({})
    expect(loaded.layoutMode).toBe(4)
  })

  it('falls back to another populated group, then the default one, then an empty grid', () => {
    store(snapshot({
      viewGroups: [group({ panes: [null] }), group({ id: 'a', layoutMode: 3, panes: ['t1'] })],
      activeGroupId: 'missing',
      tabGroups: { t1: 'a' },
    }))
    expect(loadSnapshot()?.viewGroups[0]).toMatchObject({ layoutMode: 3, panes: ['t1'] })
    store(snapshot({
      viewGroups: [group({ layoutMode: 2, panes: ['t1', null] }), group({ id: 'empty', panes: [null] })],
      activeGroupId: 'missing',
    }))
    expect(loadSnapshot()?.viewGroups[0]).toMatchObject({ layoutMode: 2, panes: ['t1', null] })
    store(snapshot({ viewGroups: [], activeGroupId: 'x', layoutMode: 5 }))
    const empty = loadSnapshot()!
    expect(empty.layoutMode).toBe(5)
    expect(empty.viewGroups[0]?.panes).toEqual(Array(8).fill(null))
  })

  it('swallows storage failures', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => saveSnapshot(snapshot() as never)).not.toThrow()
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => clearSnapshot()).not.toThrow()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(loadSnapshot()).toBeNull()
  })
})
