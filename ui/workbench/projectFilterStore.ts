import { create } from 'zustand'

import { selectedWorkspaceId, useWorkspaceStore } from '../platform/workspaceStore'

/** localStorage key of each workspace's default project: `{ [workspaceId]: folderPath }`. */
const DEFAULTS_KEY = 'omniterm.workspace.defaultProjects'

function storedDefaults(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(DEFAULTS_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

function storeDefaults(defaults: Readonly<Record<string, string>>): void {
  try {
    globalThis.localStorage?.setItem(DEFAULTS_KEY, JSON.stringify(defaults))
  } catch {
    // The default then lasts for this window only.
  }
}

export interface ProjectFilterState {
  /** 'all' or a specific project root folder path */
  filter: string | 'all'
  /**
   * The default project of each workspace, by workspace id: where a new terminal or agent starts
   * when the workspace has several projects and nothing narrower is selected.
   */
  defaults: Readonly<Record<string, string>>
  /** Shows one project (or all) in the Project panel; picking a project also makes it the default. */
  setFilter: (filter: string | 'all') => void
  setDefaultProject: (workspaceId: string, path: string) => void
  /** Forgets the chosen default: the workspace's first active project is the default again. */
  clearDefaultProject: (workspaceId: string) => void
  reset: () => void
}

const currentWorkspaceId = (): string | null => selectedWorkspaceId(useWorkspaceStore.getState().selection)

export const useProjectFilterStore = create<ProjectFilterState>((set, get) => ({
  filter: 'all',
  defaults: storedDefaults(),
  setFilter: (filter) => {
    set({ filter })
    const workspaceId = currentWorkspaceId()
    if (filter !== 'all' && workspaceId) get().setDefaultProject(workspaceId, filter)
  },
  setDefaultProject: (workspaceId, path) => {
    const defaults = { ...get().defaults, [workspaceId]: path }
    set({ defaults })
    storeDefaults(defaults)
  },
  clearDefaultProject: (workspaceId) => {
    if (!(workspaceId in get().defaults)) return
    const defaults = Object.fromEntries(Object.entries(get().defaults).filter(([id]) => id !== workspaceId))
    set({ defaults })
    storeDefaults(defaults)
  },
  reset: () => set({ filter: 'all' }),
}))

/** A path as two sources compare it: forward slashes, no trailing one, case-insensitive. */
export const comparablePath = (path: string): string => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()

/**
 * The default project among `candidates` (folder paths of the workspace, in any spelling): the one
 * chosen for workspace `workspaceId` while it is still one of them, else null.
 */
export function defaultProjectAmong(workspaceId: string | null, candidates: readonly string[]): string | null {
  const chosen = workspaceId ? useProjectFilterStore.getState().defaults[workspaceId] : undefined
  if (!chosen) return null
  const target = comparablePath(chosen)
  return candidates.find((candidate) => comparablePath(candidate) === target) ?? null
}

/** The default project of the selected workspace among `candidates`. */
export function currentDefaultProject(candidates: readonly string[]): string | null {
  return defaultProjectAmong(currentWorkspaceId(), candidates)
}

// A project filter belongs to one workspace: switching workspace shows all of its projects again.
useWorkspaceStore.subscribe((state, previous) => {
  if (selectedWorkspaceId(state.selection) !== selectedWorkspaceId(previous.selection)) {
    useProjectFilterStore.getState().reset()
  }
})
