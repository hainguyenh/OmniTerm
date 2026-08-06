/**
 * A process-wide budget for live WebGL renderer contexts, so a pane can hold its renderer for its
 * whole lifetime instead of surrendering it every time it goes off screen.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 * Browsers cap simultaneous WebGL contexts (Chromium: ~16), and this app can have an 8-pane layout
 * plus detached windows. The first attempt at staying under that cap loaded and unloaded the addon
 * on each pane's own visibility edge — which meant every tab switch destroyed a GL context and built
 * a fresh, empty texture atlas, and the pane painted from that empty atlas for a frame or two. That
 * is what the white/black flash on switching tabs was.
 *
 * Trading it the other way round — never unload — pushes the app past the cap once enough panes are
 * open, and from then on *newly opened* panes silently fall back to the DOM renderer. That penalises
 * exactly the pane the user just asked for.
 *
 * So the budget is held here rather than by each pane: every pane keeps its renderer until the cap is
 * actually reached, and only then does the least-recently-focused pane give one up. Nobody flashes on
 * a tab switch, and the pane that loses hardware rendering is the one the user has touched least.
 */

/** Leave GPU-process headroom for detached windows, RDP, and browser-owned surfaces. */
export const MAX_CONTEXTS = 6

interface Entry {
  /** Drops this holder's GL context. Called by the pool on eviction, never by the holder itself. */
  evict: () => void
}

/**
 * MRU order: index 0 is the most recently touched holder, the last entry is the first to be evicted.
 * An array rather than a Map because `MAX_CONTEXTS` is tiny and MRU reordering on a Map means delete
 * + re-set on every focus change.
 */
const holders: Array<{ key: object; entry: Entry }> = []

const indexOf = (key: object) => holders.findIndex(h => h.key === key)

const promote = (key: object, entry: Entry) => {
  const existing = indexOf(key)
  if (existing !== -1) holders.splice(existing, 1)
  holders.unshift({ key, entry })
}

/**
 * Register `key` as holding a context, evicting the least-recently-touched holder if that puts the
 * pool over budget.
 *
 * Call this AFTER the context is actually created: if creation fails (software rendering, no driver)
 * the pane never occupied a slot and must not consume one.
 */
export const acquire = (key: object, evict: () => void): void => {
  promote(key, { evict })
  while (holders.length > MAX_CONTEXTS) {
    const victim = holders.pop()
    // The holder's own `evict` clears its bookkeeping; it must not call back into `release`, or the
    // splice above would already have removed the entry and this would be a wasted scan.
    victim?.entry.evict()
  }
}

/** Mark `key` as most recently used — call it on the pane's hidden→visible edge. No-op if unknown. */
export const touch = (key: object): void => {
  const existing = indexOf(key)
  if (existing <= 0) return // absent, or already at the front
  const [held] = holders.splice(existing, 1)
  holders.unshift(held)
}

/** Give the slot back. Call on unmount, on context loss, and on eviction. Idempotent. */
export const release = (key: object): void => {
  const existing = indexOf(key)
  if (existing !== -1) holders.splice(existing, 1)
}

/** Exposed for tests: how many slots are currently held, most-recently-touched first. */
export const heldCount = (): number => holders.length

/** Exposed for tests: drop all bookkeeping without calling any holder's `evict`. */
export const resetForTests = (): void => { holders.length = 0 }
