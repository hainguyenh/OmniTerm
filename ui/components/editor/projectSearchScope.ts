import type { Workspace } from '../../domain'

/** Which workspaces the project search reads: the current one, or every workspace. */
export type ProjectSearchScope = 'current' | 'all'

const STORAGE_KEY = 'omniterm.projectSearch.scope'

export function readSearchScope(): ProjectSearchScope {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'all' ? 'all' : 'current'
  } catch {
    return 'current'
  }
}

export function saveSearchScope(scope: ProjectSearchScope): void {
  try {
    localStorage.setItem(STORAGE_KEY, scope)
  } catch {
    /* storage unavailable: the choice lasts until the window closes */
  }
}

/**
 * The workspaces to search. A workspace whose projects are all switched off has nothing to search
 * and is left out (its scans skip disabled projects anyway); the current one is always searched.
 */
export function searchTargets(
  workspaces: readonly Workspace[],
  current: Workspace | null,
  scope: ProjectSearchScope,
): Workspace[] {
  if (scope === 'current') return current ? [current] : []
  const searchable = workspaces.filter(
    (workspace) => workspace.id === current?.id || workspace.folders.some((folder) => !folder.disabled),
  )
  return searchable.length ? searchable : current ? [current] : []
}
