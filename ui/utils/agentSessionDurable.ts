/**
 * Crash-safe mirror of the renderer's agent-session stores in `app_data_dir/agent-sessions.json`.
 *
 * localStorage stays the synchronous source of truth while the app runs, but WebView2 flushes it
 * lazily: a hard kill (Task Manager, `taskkill /F`) can drop the last few seconds of writes — which
 * are exactly the writes that say "Claude session X was running in pane 1". Every change is also
 * written (debounced, atomically) through the backend, and read back once at startup.
 *
 * Stores register a named slice instead of this module importing them, so neither side depends on
 * the other's internals. Each slice validates what it is handed: the file is untrusted input.
 */
import { diag } from '../diag'

export type DurableSliceName = 'sessions' | 'pins'

interface DurableSlice {
  /** The slice's current, already-validated entries. */
  read: () => unknown[]
  /** Merge entries read from disk. `startedAt` is this run's start, for stale-state promotion. */
  hydrate: (items: unknown[], startedAt: number) => void
}

const SAVE_DELAY_MS = 150
const HYDRATE_TIMEOUT_MS = 1_500
const DOC_VERSION = 1

const slices = new Map<DurableSliceName, DurableSlice>()
let startedAt = Date.now()
let hydrated = false
let savePending = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
let hydration: Promise<void> | null = null

function durableApi() {
  const api = typeof window !== 'undefined' ? window.omnitermAPI?.agentSessions : undefined
  return api?.loadStore && api.saveStore ? { load: api.loadStore, save: api.saveStore } : null
}

export function registerDurableSlice(name: DurableSliceName, slice: DurableSlice): void {
  slices.set(name, slice)
}

function flush(): void {
  saveTimer = null
  const api = durableApi()
  if (!api) return
  const doc: Record<string, unknown> = { version: DOC_VERSION }
  for (const [name, slice] of slices) doc[name] = slice.read()
  void api.save(doc).catch((error: unknown) => diag.warn('[agentSessionDurable] save failed', error))
}

/**
 * Queue a write of every slice. Writes wait for hydration: saving first would overwrite the file
 * from the previous run with this run's (possibly empty) localStorage before it was ever read.
 */
export function scheduleDurableSave(): void {
  if (!hydrated) {
    savePending = true
    return
  }
  if (saveTimer !== null) return
  saveTimer = setTimeout(flush, SAVE_DELAY_MS)
}

function applyDoc(doc: unknown): void {
  if (!doc || typeof doc !== 'object') return
  const record = doc as Record<string, unknown>
  for (const [name, slice] of slices) {
    const items = record[name]
    if (Array.isArray(items)) slice.hydrate(items, startedAt)
  }
}

/** Read the file once per run and merge it into every registered slice. Safe to call repeatedly. */
export function hydrateAgentSessionStore(): Promise<void> {
  if (hydration) return hydration
  const api = durableApi()
  hydration = (async () => {
    if (api) {
      try {
        applyDoc(await api.load())
      } catch (error) {
        diag.warn('[agentSessionDurable] load failed', error)
      }
    }
    hydrated = true
    if (savePending) {
      savePending = false
      scheduleDurableSave()
    }
  })()
  return hydration
}

/**
 * Resolves once the file has been merged, or after a short timeout — startup restore must never
 * hang on a slow or missing backend.
 */
export function whenAgentSessionsHydrated(): Promise<void> {
  const pending = hydrateAgentSessionStore()
  return Promise.race([
    pending,
    new Promise<void>(resolve => setTimeout(resolve, HYDRATE_TIMEOUT_MS)),
  ])
}

export function resetAgentSessionDurableForTests(): void {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = null
  startedAt = Date.now()
  hydrated = false
  savePending = false
  hydration = null
}
