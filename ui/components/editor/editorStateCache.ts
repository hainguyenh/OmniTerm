/**
 * Memory budget for open-but-hidden documents.
 *
 * Every tab keeps its `EditorState` while hidden so switching back is instant. That is cheap for a
 * handful of tabs and not for thirty large ones, so past this budget the least recently shown clean,
 * hidden documents are dropped (their tab re-reads the file the next time it is shown, keeping only
 * the cursor). A document with unsaved changes is never dropped, and neither is a visible one.
 */

export const STATE_BUDGET = { maxStates: 8, maxChars: 16_000_000 }

interface Entry {
  loaded: boolean
  chars: number
  dirty: boolean
  visible: boolean
  lastShown: number
  evict: () => void
}

const entries = new Map<string, Entry>()
let clock = 0

export function registerDocument(id: string, evict: () => void): void {
  entries.set(id, { loaded: false, chars: 0, dirty: false, visible: false, lastShown: ++clock, evict })
}

export function unregisterDocument(id: string): void {
  entries.delete(id)
}

export function updateDocument(
  id: string,
  patch: Partial<Pick<Entry, 'loaded' | 'chars' | 'dirty' | 'visible'>>,
): void {
  const entry = entries.get(id)
  if (!entry) return
  if (patch.visible !== undefined && patch.visible !== entry.visible) entry.lastShown = ++clock
  Object.assign(entry, patch)
  enforceBudget()
}

function enforceBudget(): void {
  const loaded = [...entries.values()].filter((entry) => entry.loaded)
  let count = loaded.length
  let chars = loaded.reduce((sum, entry) => sum + entry.chars, 0)
  const candidates = loaded
    .filter((entry) => !entry.visible && !entry.dirty)
    .sort((a, b) => a.lastShown - b.lastShown)
  for (const entry of candidates) {
    if (count <= STATE_BUDGET.maxStates && chars <= STATE_BUDGET.maxChars) break
    entry.loaded = false
    count -= 1
    chars -= entry.chars
    entry.chars = 0
    entry.evict()
  }
}
