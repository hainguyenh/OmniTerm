import type { WorkspaceEntry } from '@omniterm/contract'

/**
 * Which of a workspace's files the panel shows.
 *
 * The backend scan reports everything a project folder contains (see `scan_workspace_entries`), so
 * changing the filter is a local re-render, never a rescan. Folders are always part of the tree —
 * `showEmptyDirs` only decides whether one with nothing left in it after filtering is worth a row.
 */
export interface TreeFilter {
  /**
   * `scripts` = runnables only (the default), `all` = every file, `types` = the `kinds` listed,
   * `selected` = the `paths` listed.
   */
  mode: 'scripts' | 'all' | 'types' | 'selected'
  /**
   * The kinds shown in `types` mode, as reported by the scan (`ps1`, `txt`, `file`, …). Ignored
   * otherwise.
   *
   * Kept alongside `paths` rather than replaced by it: a type answers "every `.ps1` in here,
   * including the ones I add tomorrow", which a fixed list of paths cannot express.
   */
  kinds: string[]
  /**
   * The files shown in `selected` mode, by workspace-relative entry id. Ignored otherwise.
   *
   * Paths, not extensions: the menu lets the user tick real files in the workspace tree, which is
   * both easier to drive and able to express "these two scripts" — something a type list cannot.
   * A file added since the selection was made is simply not in it; "Check all" takes it back.
   */
  paths: string[]
  showEmptyDirs: boolean
}

/** The kinds the backend's `classify` produces — i.e. the files the panel can run. */
export const SCRIPT_KINDS = ['bat', 'ps1', 'sh', 'rdp']

export const DEFAULT_TREE_FILTER: TreeFilter = {
  mode: 'scripts',
  kinds: [],
  paths: [],
  showEmptyDirs: false,
}

/**
 * Every kind present in a scan, sorted — the checklist the "Selected types" mode offers.
 *
 * Derived from the scan rather than from a fixed table so the list is always exactly what this
 * workspace contains: offering `.rdp` in a project with no `.rdp` file in it is noise. Hidden files
 * are skipped: they only ever appear in "All files" mode, so a kind only hidden files carry would be
 * an option that selects nothing.
 */
export function discoverKinds(entries: WorkspaceEntry[]): string[] {
  const kinds = new Set<string>()
  for (const entry of entries) {
    if (entry.isDir || isHiddenEntry(entry)) continue
    kinds.add(entry.kind || 'file')
  }
  return [...kinds].sort()
}

/**
 * Is this a hidden entry — its name, or any folder on its path, starts with a dot?
 *
 * The scan reports hidden files and folders now (`.env`, `.vscode/`, …) so "All files" can really
 * mean all files, but the other views keep the old behaviour: scripts/types/selections never show
 * dot-files unless the user explicitly picks "All files".
 */
export function isHiddenEntry(entry: WorkspaceEntry): boolean {
  return entry.name.startsWith('.') || entry.id.split('/').some(seg => seg.startsWith('.'))
}

/** Is this entry a runnable script (as opposed to a folder or a plain file)? */
export function isScriptEntry(entry: WorkspaceEntry): boolean {
  return !entry.isDir && (SCRIPT_KINDS.includes(entry.kind) || entry.editable !== undefined)
}

/**
 * Is the tree showing what it shows out of the box?
 *
 * Drives the "this filter is doing something" tint on the panel's controls, so it deliberately
 * ignores `paths`: those only matter in `selected` mode, which is itself a departure from the default.
 */
export function isDefaultFilter(filter: TreeFilter): boolean {
  return filter.mode === DEFAULT_TREE_FILTER.mode
    && filter.showEmptyDirs === DEFAULT_TREE_FILTER.showEmptyDirs
}

/**
 * What the panel's option row says it is showing — the filter's state in three words or fewer.
 *
 * `count` is how many files survived the filter, and only earns a mention in `selected` mode: for
 * `scripts` and `all` the mode name already says everything, and a number there would just be noise.
 * `types` names the type outright while there is only one, which is the common case.
 */
export function filterSummary(filter: TreeFilter, count: number): string {
  if (filter.mode === 'all') return 'All files'
  if (filter.mode === 'scripts') return 'Scripts'
  if (filter.mode === 'types') {
    return filter.kinds.length === 1 ? `.${filter.kinds[0]}` : `${filter.kinds.length} types`
  }
  return count === 1 ? '1 file' : `${count} files`
}

/** Does `filter` admit this file? (Folders are decided by `applyFilter`, not here.) */
function keepsFile(entry: WorkspaceEntry, filter: TreeFilter, chosen: Set<string>): boolean {
  if (filter.mode === 'all') return true
  if (filter.mode === 'selected') return chosen.has(entry.id)
  if (filter.mode === 'types') return filter.kinds.includes(entry.kind || 'file')
  return isScriptEntry(entry)
}

/** Every ancestor of `id`, by relative path (not including `id` itself). */
function ancestorsOf(id: string): string[] {
  const out: string[] = []
  let dir = id.slice(0, Math.max(0, id.lastIndexOf('/')))
  while (dir) {
    out.push(dir)
    dir = dir.slice(0, Math.max(0, dir.lastIndexOf('/')))
  }
  return out
}

/**
 * Narrow a scan to what the filter admits.
 *
 * With `showEmptyDirs` off, a directory survives only if a kept file lives somewhere beneath it, or
 * it (or a descendant of it) is named in `keepDirs`. Connections are never filtered: they are not
 * files, and hiding one would hide the only way to reach it, which is why the panel passes the
 * folders holding connections as `keepDirs`. The panel also passes every folder the user has
 * explicitly expanded, and every folder whose files have not been loaded yet (folders are lazy, see
 * useWorkspaceScan): their contents are *unknown* or intentionally visible, so pruning them would
 * make an open or unopened folder look empty — and an open one would vanish out from under the user.
 *
 * `keepDirs` propagates to ancestors (a kept leaf folder must not lose its parent row and get
 * re-synthesised as a placeholder), matching how `populated` already walks up from a kept file.
 */
export function applyFilter(
  entries: WorkspaceEntry[],
  filter: TreeFilter,
  keepDirs?: Set<string>,
): WorkspaceEntry[] {
  const chosen = filter.mode === 'selected' ? new Set(filter.paths) : new Set<string>()
  // Hidden entries exist only for "All files": the other modes behaved as if the scan never saw
  // dot-files, and nothing in their semantics asks for them now.
  const base = filter.mode === 'all' ? entries : entries.filter(e => !isHiddenEntry(e))
  const files = base.filter(entry => !entry.isDir && keepsFile(entry, filter, chosen))
  if (filter.showEmptyDirs) return [...base.filter(entry => entry.isDir), ...files]

  // Every ancestor directory of a kept file, by relative path.
  const populated = new Set<string>()
  for (const file of files) {
    for (const dir of ancestorsOf(file.id)) populated.add(dir)
  }
  // Every ancestor of a `keepDirs` member, so a kept folder never loses its parent row.
  const keptAncestors = new Set<string>()
  if (keepDirs) {
    for (const id of keepDirs) {
      keptAncestors.add(id)
      for (const dir of ancestorsOf(id)) keptAncestors.add(dir)
    }
  }
  return [
    ...base.filter(entry => entry.isDir && (populated.has(entry.id) || keptAncestors.has(entry.id))),
    ...files,
  ]
}

/**
 * Directories the given connection parent paths live under, plus their ancestors.
 *
 * A connection saved against a folder must keep that folder visible even when `showEmptyDirs` is off
 * and the folder holds no matching file — otherwise the connection would be re-parented to the root
 * purely because of a display filter.
 */
export function dirsHoldingConnections(parentIds: (string | undefined)[]): Set<string> {
  const needed = new Set<string>()
  for (const parentId of parentIds) {
    let dir = parentId ?? ''
    while (dir) {
      if (needed.has(dir)) break
      needed.add(dir)
      dir = dir.slice(0, Math.max(0, dir.lastIndexOf('/')))
    }
  }
  return needed
}
