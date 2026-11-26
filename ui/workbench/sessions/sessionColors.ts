import { create } from 'zustand'

import { PANE_IDENTITY, type PaneIdentity } from '../../paneIdentity'

/**
 * One colour (and shape) per session, shared by the session's editor tab and its row in the
 * Sessions tool window, so the two always match and changing it in one place changes both.
 * The palette is the old pane identity palette. A session keeps its colour wherever its tab is
 * dragged; new sessions take the first colour no live session uses.
 */

const STORAGE_KEY = 'omniterm.sessionColors.v1'

interface SessionColorState {
  /** Session id to palette index. */
  byId: Record<string, number>
}

function validIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < PANE_IDENTITY.length
}

/** Persisted choices are untrusted: only plain ids with a valid palette index survive. */
export function parseStoredColors(raw: unknown): Record<string, number> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [id, index] of Object.entries(raw)) {
    if (id.length > 0 && id.length <= 200 && validIndex(index)) out[id] = index
  }
  return out
}

function load(): Record<string, number> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    return raw ? parseStoredColors(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

function save(byId: Record<string, number>): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(byId))
  } catch {
    // Storage may be blocked or full: colours then last for this run only.
  }
}

export const useSessionColors = create<SessionColorState>(() => ({ byId: load() }))

/** First palette index no id of `taken` has, else the least used one. */
export function nextFreeIndex(taken: readonly number[]): number {
  const counts = PANE_IDENTITY.map(() => 0)
  for (const index of taken) counts[index] = (counts[index] ?? 0) + 1
  return counts.indexOf(Math.min(...counts))
}

/**
 * Gives every id of `liveIds` a colour and forgets the colours of ended sessions.
 * Idempotent: it writes only when something changed.
 */
export function syncSessionColors(liveIds: readonly string[]): void {
  const { byId } = useSessionColors.getState()
  const next: Record<string, number> = {}
  for (const id of liveIds) if (byId[id] !== undefined) next[id] = byId[id]
  for (const id of liveIds) {
    if (next[id] === undefined) next[id] = nextFreeIndex(Object.values(next))
  }
  const same = Object.keys(next).length === Object.keys(byId).length && Object.entries(next).every(([id, index]) => byId[id] === index)
  if (same) return
  useSessionColors.setState({ byId: next })
  save(next)
}

/** The next palette colour for a session (what a click on its marker does), in both places at once. */
export function cycleSessionColor(id: string): void {
  const { byId } = useSessionColors.getState()
  const next = { ...byId, [id]: (((byId[id] ?? 0) + 1) % PANE_IDENTITY.length) }
  useSessionColors.setState({ byId: next })
  save(next)
}

const FALLBACK = 0

export function identityFor(index: number | undefined): PaneIdentity {
  return PANE_IDENTITY[validIndex(index) ? index : FALLBACK]!
}

export function useSessionIdentity(id: string): PaneIdentity {
  return identityFor(useSessionColors((state) => state.byId[id]))
}
