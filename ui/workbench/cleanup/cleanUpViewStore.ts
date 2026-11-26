import { create } from 'zustand'

import { focusToolWindow, isToolWindowVisible } from '../../ide/workbench/toolwindows/store'

/** Id of the Clean Up tool window. */
export const CLEANUP_TOOL_WINDOW = 'omniterm.cleanup'

export type CleanUpTab = 'sessions' | 'temp' | 'rust' | 'worktrees' | 'test-data'

interface CleanUpViewState {
  tab: CleanUpTab
  setTab: (tab: CleanUpTab) => void
  /** Opens the Clean Up tool window on `tab`. */
  show: (tab: CleanUpTab) => void
}

export const useCleanUpView = create<CleanUpViewState>((set) => ({
  tab: 'rust',
  setTab: (tab) => set({ tab }),
  show: (tab) => {
    set({ tab })
    focusToolWindow(CLEANUP_TOOL_WINDOW)
  },
}))

/** Whether `tab` is on screen: a job that finishes elsewhere says so in a notification. */
export function isCleanUpTabShown(tab: CleanUpTab): boolean {
  return useCleanUpView.getState().tab === tab && isToolWindowVisible(CLEANUP_TOOL_WINDOW)
}
