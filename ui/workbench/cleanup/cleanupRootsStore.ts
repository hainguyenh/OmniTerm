import { create } from 'zustand'

import { diag } from '../../diag'

/** Folders searched on top of the workspaces by Clean Up › Rust and › Worktrees. */
const STORAGE_KEY = 'omniterm:cleanup-roots'
/** The backend refuses more than this many added folders. */
export const MAX_EXTRA_ROOTS = 32

/** The stored folder list, or none when missing or not a list of strings. */
export function readStoredRoots(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, MAX_EXTRA_ROOTS) : []
  } catch {
    return []
  }
}

function load(): string[] {
  try {
    return readStoredRoots(localStorage.getItem(STORAGE_KEY))
  } catch {
    return []
  }
}

function save(roots: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(roots))
  } catch (error) {
    diag.warn('[CleanUp] could not remember the added folders', error)
  }
}

interface CleanupRootsState {
  roots: string[]
  add: (root: string) => void
  remove: (root: string) => void
}

export const useCleanupRoots = create<CleanupRootsState>((set, get) => ({
  roots: load(),
  add: (root) => {
    const current = get().roots
    if (!root || current.includes(root) || current.length >= MAX_EXTRA_ROOTS) return
    const roots = [...current, root]
    save(roots)
    set({ roots })
  },
  remove: (root) => {
    const roots = get().roots.filter((item) => item !== root)
    save(roots)
    set({ roots })
  },
}))
