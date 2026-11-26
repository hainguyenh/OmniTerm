import { create } from 'zustand'

import type { Workspace } from '../domain'

import {
  decodeWorkspaceSelection,
  encodeWorkspaceSelection,
  normalizeWorkspaceSelection,
} from '../utils/workspaceSelection'

/** localStorage key of the last selected workspace (an id or a `workspaceId::folderId` selection). */
export const LAST_WORKSPACE_KEY = 'omniterm:last-workspace'

/** The persisted selection; storage is optional (private windows, blocked site data). */
export function readStoredSelection(): string | null {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY)
  } catch {
    return null
  }
}

/** localStorage key of the workspace scope: `all` while "All workspaces" is picked. */
export const WORKSPACE_SCOPE_KEY = 'omniterm:workspace-scope'

/**
 * Which workspaces the Sessions and Connections windows list: the selected one, or every one
 * ("All workspaces" in the title bar popup). The project tree always follows the selection.
 */
export type WorkspaceScope = 'workspace' | 'all'

function readStoredScope(): WorkspaceScope {
  try {
    return localStorage.getItem(WORKSPACE_SCOPE_KEY) === 'all' ? 'all' : 'workspace'
  } catch {
    return 'workspace'
  }
}

function storeScope(scope: WorkspaceScope): void {
  try {
    if (scope === 'all') localStorage.setItem(WORKSPACE_SCOPE_KEY, 'all')
    else localStorage.removeItem(WORKSPACE_SCOPE_KEY)
  } catch {
    /* storage is optional */
  }
}

export function storeSelection(selection: string | null): void {
  try {
    if (selection) localStorage.setItem(LAST_WORKSPACE_KEY, selection)
    else localStorage.removeItem(LAST_WORKSPACE_KEY)
  } catch {
    /* storage is optional */
  }
}

type Update<T> = T | ((current: T) => T)

interface WorkspaceState {
  workspaces: Workspace[]
  /** Whether the catalog has been read at least once. */
  loaded: boolean
  /** The selected workspace as `workspaceId` or `workspaceId::folderId`. */
  selection: string | null
  scope: WorkspaceScope
  /** Reads the catalog and keeps the selection pointing at a workspace that still exists. */
  refresh: () => Promise<void>
  setWorkspaces: (next: Update<Workspace[]>) => void
  /** Selects a raw selection string (the new-terminal menu picks folders too). */
  setSelection: (next: Update<string | null>) => void
  /** Selects a whole workspace (scope back to that workspace); an empty one then has no project. */
  selectWorkspace: (workspaceId: string) => void
  setScope: (scope: WorkspaceScope) => void
}

const resolve = <T,>(next: Update<T>, current: T): T => (typeof next === 'function' ? (next as (c: T) => T)(current) : next)

/**
 * The one source of truth for the workspace the window works on. The sessions panel, the project
 * tree (through the project bridge) and the title bar all read the selection from here, so a switch
 * anywhere is a switch everywhere.
 */
export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  loaded: false,
  selection: readStoredSelection(),
  scope: readStoredScope(),
  refresh: async () => {
    let list: Workspace[]
    try {
      // Typed locally: the upstream title bar (a separate TS project) imports this store.
      const api = (window as unknown as { omnitermAPI: { workspace: { list(): Promise<Workspace[]> } } }).omnitermAPI
      list = await api.workspace.list()
    } catch {
      set({ workspaces: [], loaded: true })
      return
    }
    set({ workspaces: list, loaded: true })
    get().setSelection((current) => normalizeWorkspaceSelection(list, current))
  },
  setWorkspaces: (next) => set((state) => ({ workspaces: resolve(next, state.workspaces) })),
  setSelection: (next) => {
    const selection = resolve(next, get().selection)
    if (selection === get().selection) return
    storeSelection(selection)
    set({ selection })
  },
  selectWorkspace: (workspaceId) => {
    const { workspaces, selection } = get()
    const current = decodeWorkspaceSelection(selection)
    const normalized = normalizeWorkspaceSelection(workspaces, current?.workspaceId === workspaceId ? selection : workspaceId)
    const target = decodeWorkspaceSelection(normalized)?.workspaceId === workspaceId ? normalized : encodeWorkspaceSelection(workspaceId)
    get().setSelection(target)
    get().setScope('workspace')
  },
  setScope: (scope) => {
    if (scope === get().scope) return
    storeScope(scope)
    set({ scope })
  },
}))

/** Whether the Sessions and Connections windows list every workspace (only when there are several). */
export function isAllScope(state: Pick<WorkspaceState, 'scope' | 'workspaces'>): boolean {
  return state.scope === 'all' && state.workspaces.length > 1
}

/** The workspace the Sessions and Connections windows are scoped to; null lists every workspace. */
export function scopedWorkspaceId(state: Pick<WorkspaceState, 'scope' | 'selection' | 'workspaces'>): string | null {
  return isAllScope(state) ? null : selectedWorkspaceId(state.selection)
}

/** The id of the selected workspace (without the folder part). */
export function selectedWorkspaceId(selection: string | null): string | null {
  return decodeWorkspaceSelection(selection)?.workspaceId ?? null
}

/** The selected workspace, or null while the catalog is empty or the selection is stale. */
export function useSelectedWorkspace(): Workspace | null {
  return useWorkspaceStore((s) => {
    const id = selectedWorkspaceId(s.selection)
    return s.workspaces.find((workspace) => workspace.id === id) ?? null
  })
}

/** The selected workspace's name, for the title bar's project widget. */
export function useWorkspaceTitle(): string | null {
  return useWorkspaceStore((s) => {
    if (isAllScope(s)) return 'All workspaces'
    const id = selectedWorkspaceId(s.selection)
    return s.workspaces.find((workspace) => workspace.id === id)?.name ?? null
  })
}
