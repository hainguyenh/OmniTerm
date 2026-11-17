import { create } from 'zustand'

import { diag } from '../../diag'
import { useSessionBridge, type SessionInfo } from '../sessions/sessionBridge'
import { parseSessionInput, sessionInput } from '../sessions/sessionInput'

/**
 * Sessions docked in the bottom Terminal tool window instead of the editor. A docked session has no
 * editor tab (the tab reconciler leaves it alone); its terminal surface is lent to the tool window.
 * Only session ids are kept, in this window's local storage, so a restart docks them again.
 */
interface TerminalDockState {
  /** In tab order. */
  docked: readonly string[]
  active: string | null
  /**
   * Sessions that were docked when they ended (or when the app quit), newest last: resuming one of
   * them puts the new session back in the dock instead of an editor tab.
   */
  ended: readonly string[]
  /** New sessions asked for from the tool window that have not shown up yet. */
  pending: number
  pendingSince: number
}

const STORAGE_KEY = 'omniterm.terminalDock'
/** A requested shell that has not started within this time is no longer waited for. */
export const PENDING_DOCK_MS = 15_000
const ENDED_LIMIT = 50

const validId = (value: unknown): value is string =>
  typeof value === 'string' && parseSessionInput(sessionInput(value)) === value

type Saved = Pick<TerminalDockState, 'docked' | 'active' | 'ended'>

const validIds = (value: unknown): string[] => (Array.isArray(value) ? [...new Set(value.filter(validId))] : [])

function load(): Saved {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return { docked: [], active: null, ended: [] }
    const { docked, active, ended } = raw as { docked?: unknown; active?: unknown; ended?: unknown }
    const ids = validIds(docked).slice(0, 50)
    return {
      docked: ids,
      active: validId(active) && ids.includes(active) ? active : ids[0] ?? null,
      ended: validIds(ended).slice(-ENDED_LIMIT),
    }
  } catch (error) {
    diag.warn('[terminal-dock] ignoring unreadable saved state', error)
    return { docked: [], active: null, ended: [] }
  }
}

function save(state: Saved): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ docked: state.docked, active: state.active, ended: state.ended }))
  } catch (error) {
    diag.warn('[terminal-dock] could not save the docked sessions', error)
  }
}

export const useTerminalDock = create<TerminalDockState>(() => ({ ...load(), pending: 0, pendingSince: 0 }))

function update(next: Partial<TerminalDockState>): void {
  useTerminalDock.setState(next)
  if ('docked' in next || 'active' in next || 'ended' in next) save(useTerminalDock.getState())
}

export function isDocked(id: string): boolean {
  return useTerminalDock.getState().docked.includes(id)
}

/** Moves a session into the Terminal tool window and makes it the shown one. */
export function dockSession(id: string): void {
  if (!validId(id)) return
  const { docked } = useTerminalDock.getState()
  update({ docked: docked.includes(id) ? docked : [...docked, id], active: id })
}

/** Takes a session out of the tool window (it goes back to an editor tab, or it ended). */
export function undockSession(id: string): void {
  const { docked, active } = useTerminalDock.getState()
  const index = docked.indexOf(id)
  if (index < 0) return
  const rest = docked.filter((item) => item !== id)
  const nextActive = active === id ? rest[Math.min(index, rest.length - 1)] ?? null : active
  update({ docked: rest, active: nextActive })
}

/** Whether `id` was docked when it ended: its resumed session belongs in the dock again. */
export function endedDocked(id: string): boolean {
  return useTerminalDock.getState().ended.includes(id)
}

/** A docked session ended (or did not come back after a restart): it leaves the dock, remembered. */
function endDocked(id: string): void {
  undockSession(id)
  const ended = useTerminalDock.getState().ended.filter((item) => item !== id)
  update({ ended: [...ended, id].slice(-ENDED_LIMIT) })
}

export function selectDocked(id: string): void {
  if (isDocked(id)) update({ active: id })
}

/** The next new session of this window is docked (the tool window's "+"). */
export function expectDockedSession(now = Date.now()): void {
  const { pending, pendingSince } = useTerminalDock.getState()
  const stale = now - pendingSince >= PENDING_DOCK_MS
  update({ pending: (stale ? 0 : pending) + 1, pendingSince: now })
}

/**
 * Keeps the dock in step with the window's sessions: a requested shell that appears is docked, and
 * a docked session that ended leaves the dock. Runs synchronously on every bridge update, so a new
 * docked session is claimed before the tab reconciler (which runs a tick later) gives it a tab.
 */
export function startTerminalDockSync(now: () => number = Date.now): () => void {
  let known: Set<string> | null = null
  const sync = (sessions: readonly SessionInfo[], settled: boolean, connected: boolean) => {
    if (!settled || !connected) return
    const live = new Set(sessions.map((session) => session.id))
    const first = known === null
    for (const id of live) {
      if (first || known?.has(id)) continue
      const { pending, pendingSince } = useTerminalDock.getState()
      if (pending > 0 && now() - pendingSince < PENDING_DOCK_MS) {
        dockSession(id)
        update({ pending: pending - 1 })
      }
    }
    known = live
    for (const id of useTerminalDock.getState().docked) if (!live.has(id)) endDocked(id)
  }
  const read = () => {
    const state = useSessionBridge.getState()
    sync(state.sessions, state.restoreSettled, state.api !== null)
  }
  read()
  return useSessionBridge.subscribe(read)
}

/** Test hook. */
export function resetTerminalDock(): void {
  useTerminalDock.setState({ docked: [], active: null, ended: [], pending: 0, pendingSince: 0 })
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage may be unavailable in tests; the in-memory reset above is what matters.
  }
}
