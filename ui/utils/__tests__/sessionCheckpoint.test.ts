import { describe, expect, it } from 'vitest'
import { SNAPSHOT_VERSION, type SessionSnapshot } from '../sessionStore'
import { mergePendingSnapshot } from '../sessionCheckpoint'

const snapshot = (overrides: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  version: SNAPSHOT_VERSION,
  activeTabs: [],
  ephemeralConns: [],
  viewGroups: [{
    id: 'ungrouped',
    label: 'Ungrouped',
    layoutMode: 2,
    panes: [null, null, null, null, null, null, null, null],
    focusedPane: 0,
  }],
  tabGroups: {},
  activeGroupId: 'ungrouped',
  layoutMode: 2,
  revision: 4,
  ...overrides,
})

describe('mergePendingSnapshot', () => {
  it('keeps the pending cwd when the current tab is only a restore placeholder', () => {
    const current = snapshot({
      activeTabs: [{
        id: 'tab-a',
        connId: 'conn-a',
        name: 'Placeholder',
        recovery: { cwdSource: 'unknown' },
      }],
    })
    const pending = snapshot({
      activeTabs: [{
        id: 'tab-a',
        connId: 'conn-a',
        name: 'Recovered',
        recovery: { cwd: 'F:/saved', cwdSource: 'reported', shell: 'powershell' },
      }],
    })

    expect(mergePendingSnapshot(current, pending).activeTabs[0]).toEqual({
      ...current.activeTabs[0],
      recovery: pending.activeTabs[0].recovery,
    })
  })

  it('retains unresolved tabs, connection metadata, and pane positions', () => {
    const current = snapshot({
      activeTabs: [{ id: 'tab-a', connId: 'conn-a', name: 'A', recovery: { cwdSource: 'unknown' } }],
      ephemeralConns: [{ id: 'conn-a', name: 'A', type: 'LOCAL' }],
      viewGroups: [{
        id: 'ungrouped',
        label: 'Ungrouped',
        layoutMode: 2,
        panes: ['tab-a', null, null, null, null, null, null, null],
        focusedPane: 0,
      }],
    })
    const pending = snapshot({
      activeTabs: [{
        id: 'tab-b',
        connId: 'conn-b',
        name: 'B',
        recovery: { cwd: 'F:/saved', cwdSource: 'reported', shell: 'powershell' },
      }],
      ephemeralConns: [{ id: 'conn-b', name: 'B', type: 'LOCAL', shell: 'powershell' }],
      viewGroups: [{
        id: 'ungrouped',
        label: 'Ungrouped',
        layoutMode: 2,
        panes: [null, 'tab-b', null, null, null, null, null, null],
        focusedPane: 1,
      }],
      tabGroups: { 'tab-b': 'ungrouped' },
    })

    const merged = mergePendingSnapshot(current, pending)
    expect(merged.activeTabs.map(tab => tab.id)).toEqual(['tab-a', 'tab-b'])
    expect(merged.ephemeralConns.map(conn => conn.id)).toEqual(['conn-a', 'conn-b'])
    expect(merged.activeTabs[1].recovery.cwd).toBe('F:/saved')
    expect(merged.viewGroups[0].panes.slice(0, 2)).toEqual(['tab-a', 'tab-b'])
    expect(merged.tabGroups['tab-b']).toBe('ungrouped')
  })
})
