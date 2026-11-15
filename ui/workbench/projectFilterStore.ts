import { create } from 'zustand'

import { selectedWorkspaceId, useWorkspaceStore } from '../platform/workspaceStore'

export interface ProjectFilterState {
  /** 'all' or a specific project root folder path */
  filter: string | 'all'
  setFilter: (filter: string | 'all') => void
  reset: () => void
}

export const useProjectFilterStore = create<ProjectFilterState>((set) => ({
  filter: 'all',
  setFilter: (filter) => set({ filter }),
  reset: () => set({ filter: 'all' }),
}))

// A project filter belongs to one workspace: switching workspace shows all of its projects again.
useWorkspaceStore.subscribe((state, previous) => {
  if (selectedWorkspaceId(state.selection) !== selectedWorkspaceId(previous.selection)) {
    useProjectFilterStore.getState().reset()
  }
})
