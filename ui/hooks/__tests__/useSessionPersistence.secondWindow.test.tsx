/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../../utils/sessionOwnerWindow', () => ({ ownsSessionPersistence: () => false }))

import { useSessionPersistence } from '../useSessionPersistence'
import { SNAPSHOT_KEY, SNAPSHOT_VERSION } from '../../utils/sessionStore'

// Regression: a second project window restored the shared snapshot, which kills and recreates the
// daemon session under every saved tab id, and overwrote the main window's layout on its next save.
describe('useSessionPersistence in a window that does not own the sessions', () => {
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

  it('neither restores the saved layout nor writes its own over it', () => {
    const saved = JSON.stringify({
      version: SNAPSHOT_VERSION,
      activeTabs: [{ id: 'tab-1', connId: 'c', name: 'PowerShell', recovery: { cwdSource: 'unknown' } }],
      ephemeralConns: [],
      viewGroups: [],
      tabGroups: {},
      activeGroupId: 'ungrouped',
      layoutMode: 1,
      revision: 3,
    })
    storage[SNAPSHOT_KEY] = saved

    const { result } = renderHook(() => useSessionPersistence({
      activeTabs: [{ id: 'tab-9', connId: 'c9', name: 'Other' }],
      ephemeralConns: [{ id: 'c9', name: 'Other', type: 'LOCAL', host: '', port: '', user: '' }],
      viewGroups: [],
      layoutMode: 1,
    }))

    expect(result.current.initialSnapshot).toBeNull()
    expect(storage[SNAPSHOT_KEY]).toBe(saved)
  })
})
