import { create } from 'zustand'

/**
 * View state of the Sessions tool window that its header buttons share with the panel below them:
 * whether the quick start popup is open, and which project groups are folded. A group follows
 * `allCollapsed` until the user toggles it on its own.
 */
interface SessionsViewState {
  quickStartOpen: boolean
  allCollapsed: boolean
  collapsed: Readonly<Record<string, boolean>>
  setQuickStartOpen(open: boolean): void
  toggleGroup(key: string): void
  collapseAll(): void
}

export const useSessionsView = create<SessionsViewState>((set, get) => ({
  quickStartOpen: false,
  allCollapsed: false,
  collapsed: {},
  setQuickStartOpen: (open) => set({ quickStartOpen: open }),
  toggleGroup: (key) => {
    const { collapsed, allCollapsed } = get()
    set({ collapsed: { ...collapsed, [key]: !(collapsed[key] ?? allCollapsed) } })
  },
  collapseAll: () => set({ allCollapsed: true, collapsed: {} }),
}))

/** Whether a project group of the Sessions tree is folded. */
export function isGroupCollapsed(state: Pick<SessionsViewState, 'collapsed' | 'allCollapsed'>, key: string): boolean {
  return state.collapsed[key] ?? state.allCollapsed
}
