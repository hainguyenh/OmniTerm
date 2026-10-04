import type { GitFileHistoryEntry } from './gitTypes'

/** What the history diff compares the selected commit's version against. */
export type GitHistoryCompareMode = 'commit' | 'working'

/** One side of the history diff: a blob at a revision, the working-tree file, or nothing at all. */
export type GitHistorySide =
  | { kind: 'revision'; revision: string; path: string; label: string }
  | { kind: 'working'; path: string; label: string }
  | { kind: 'empty'; label: string }

/**
 * The two sides to diff for history entry `index`.
 *
 * In `commit` mode the left side is the commit's first parent, read at the path the file had in the
 * next-older history entry — the name it carried before a rename this commit may have made. In
 * `working` mode the selected version is compared with the file as it is on disk now.
 */
export function historySides(
  entries: GitFileHistoryEntry[],
  index: number,
  mode: GitHistoryCompareMode,
  currentPath: string,
): { before: GitHistorySide; after: GitHistorySide } | null {
  const entry = entries[index]
  if (!entry) return null
  const { commit, path } = entry
  const selected: GitHistorySide = { kind: 'revision', revision: commit.id, path, label: `${commit.short_id} · ${path}` }
  if (mode === 'working') {
    return { before: selected, after: { kind: 'working', path: currentPath, label: `Working copy · ${currentPath}` } }
  }
  const olderPath = entries[index + 1]?.path ?? path
  const parent = commit.parents[0]
  const before: GitHistorySide = parent
    ? { kind: 'revision', revision: `${commit.id}^`, path: olderPath, label: `${parent.slice(0, 7)} · ${olderPath}` }
    : { kind: 'empty', label: 'Root commit · file did not exist' }
  return { before, after: selected }
}

/** Index after moving `delta` rows, clamped to the list. */
export function moveSelection(index: number, delta: number, count: number): number {
  if (count === 0) return 0
  return Math.min(Math.max(index + delta, 0), count - 1)
}

export function formatCommitDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
