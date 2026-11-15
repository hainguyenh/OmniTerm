/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetSessionBridge, useSessionBridge, type SessionBridgeApi, type SessionInfo } from '../sessions/sessionBridge'
import {
  PENDING_DOCK_MS,
  dockSession,
  expectDockedSession,
  isDocked,
  resetTerminalDock,
  selectDocked,
  startTerminalDockSync,
  undockSession,
  useTerminalDock,
} from '../terminalDock/terminalDockStore'

const STORAGE_KEY = 'omniterm.terminalDock'
const api = { killSession: vi.fn() } as unknown as SessionBridgeApi
const info = (id: string): SessionInfo => ({
  id,
  connId: id,
  name: id,
  connType: 'LOCAL',
  workspaceId: null,
  status: 'connected',
  busy: false,
  cwd: null,
  hasCommand: false,
})
const publish = (...ids: string[]) => useSessionBridge.setState({ sessions: ids.map(info), api, restoreSettled: true })
const saved = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown

beforeEach(() => resetTerminalDock())
afterEach(() => {
  resetTerminalDock()
  resetSessionBridge()
})

describe('terminal dock', () => {
  it('docks, selects and undocks sessions, and saves the ids', () => {
    dockSession('a')
    dockSession('b')
    dockSession('a')
    expect(useTerminalDock.getState()).toMatchObject({ docked: ['a', 'b'], active: 'a' })
    selectDocked('b')
    selectDocked('unknown')
    expect(useTerminalDock.getState().active).toBe('b')
    expect(saved()).toEqual({ docked: ['a', 'b'], active: 'b' })
    undockSession('b')
    expect(useTerminalDock.getState()).toMatchObject({ docked: ['a'], active: 'a' })
    undockSession('missing')
    expect(isDocked('a')).toBe(true)
    expect(isDocked('b')).toBe(false)
  })

  it('keeps the active session when another one is undocked, and empties cleanly', () => {
    dockSession('a')
    dockSession('b')
    dockSession('c')
    selectDocked('a')
    undockSession('c')
    expect(useTerminalDock.getState()).toMatchObject({ docked: ['a', 'b'], active: 'a' })
    undockSession('a')
    undockSession('b')
    expect(useTerminalDock.getState()).toMatchObject({ docked: [], active: null })
  })

  it('ignores an id that is not a session id', () => {
    dockSession('')
    expect(useTerminalDock.getState().docked).toEqual([])
  })
})

describe('restoring the saved dock', () => {
  const load = async () => {
    vi.resetModules()
    const store = await import('../terminalDock/terminalDockStore')
    return store.useTerminalDock.getState()
  }

  afterEach(() => localStorage.removeItem(STORAGE_KEY))

  it('keeps valid, unique ids and a valid active one', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ docked: ['a', 'a', 7, '', 'b'], active: 'b' }))
    expect(await load()).toMatchObject({ docked: ['a', 'b'], active: 'b' })
  })

  it('falls back to the first id when the active one is not docked', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ docked: ['a'], active: 'z' }))
    expect(await load()).toMatchObject({ docked: ['a'], active: 'a' })
  })

  it('starts empty from unreadable or foreign data', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(await load()).toMatchObject({ docked: [], active: null })
    localStorage.setItem(STORAGE_KEY, '"text"')
    expect(await load()).toMatchObject({ docked: [], active: null })
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ docked: 'a' }))
    expect(await load()).toMatchObject({ docked: [], active: null })
  })
})

describe('dock sync', () => {
  it('docks a requested new session and leaves other new sessions in the editor', () => {
    let now = 1_000
    publish('old')
    const stop = startTerminalDockSync(() => now)
    expectDockedSession(now)
    publish('old', 'mine')
    publish('old', 'mine', 'other')
    expect(useTerminalDock.getState()).toMatchObject({ docked: ['mine'], active: 'mine', pending: 0 })
    now += 10
    stop()
  })

  it('does not dock sessions that were already there when sync started', () => {
    publish('a')
    expectDockedSession(1_000)
    const stop = startTerminalDockSync(() => 1_000)
    publish('a')
    expect(useTerminalDock.getState().docked).toEqual([])
    stop()
  })

  it('stops waiting for a requested shell after the timeout', () => {
    publish()
    const stop = startTerminalDockSync(() => 1_000 + PENDING_DOCK_MS)
    expectDockedSession(1_000)
    publish('late')
    expect(useTerminalDock.getState().docked).toEqual([])
    stop()
  })

  it('counts a stale request as expired when a new one is made', () => {
    expectDockedSession(0)
    expectDockedSession(PENDING_DOCK_MS)
    expect(useTerminalDock.getState()).toMatchObject({ pending: 1, pendingSince: PENDING_DOCK_MS })
    expectDockedSession(PENDING_DOCK_MS + 1)
    expect(useTerminalDock.getState().pending).toBe(2)
  })

  it('undocks a session that ended, but only once the sessions are known', () => {
    dockSession('gone')
    useSessionBridge.setState({ sessions: [], api: null, restoreSettled: true })
    const stop = startTerminalDockSync()
    expect(isDocked('gone')).toBe(true)
    useSessionBridge.setState({ restoreSettled: false, api })
    expect(isDocked('gone')).toBe(true)
    publish('other')
    expect(isDocked('gone')).toBe(false)
    stop()
  })
})
