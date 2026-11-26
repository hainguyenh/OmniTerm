import { useSyncExternalStore } from 'react'

/**
 * The clock every countdown reads, kept apart from the quota store: the engine advances it once a
 * second, and only the components that show time hear about it — the store's own subscribers
 * (the status bar, pane strips, overlays) no longer re-render on every tick.
 */

let now = Date.now()
const listeners = new Set<() => void>()

export const getQuotaNow = (): number => now

export function setQuotaNow(next: number): void {
  if (next === now) return
  now = next
  for (const listener of [...listeners]) listener()
}

export function subscribeQuotaClock(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test hook: the clock back at the current time, without listeners. */
export function resetQuotaClock(): void {
  now = Date.now()
  listeners.clear()
}

/** The clock at its full one-second resolution, for a countdown that is on screen right now. */
export function useQuotaNow(): number {
  return useSyncExternalStore(subscribeQuotaClock, getQuotaNow, getQuotaNow)
}

/**
 * The clock rounded to a coarse bucket, so a subscriber re-renders only when the text it shows can
 * change: every 30s, or every second once `nearestDeadlineMs` (a window's own `resetsAt`) is under
 * two minutes away.
 */
export function useCoarseNow(nearestDeadlineMs?: number): number {
  const coarse = () => {
    const bucketMs = nearestDeadlineMs !== undefined && nearestDeadlineMs - now < 120_000 ? 1_000 : 30_000
    return Math.floor(now / bucketMs) * bucketMs
  }
  return useSyncExternalStore(subscribeQuotaClock, coarse, coarse)
}
