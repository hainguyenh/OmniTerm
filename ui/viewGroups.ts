import type { LayoutMode } from './themes'

/**
 * A workspace has one pane grid. Session snapshots still store their layout as a list of "view
 * groups" so older and newer builds can read each other's files; the app now writes exactly one
 * group, the default one, and `migrateSnapshotLayout` (sessionStore.ts) folds older snapshots into it.
 */
export const VIEW_GROUP_MAX_PLANES = 8
export const DEFAULT_VIEW_GROUP_ID = 'ungrouped'

export interface ViewGroup {
  id: string
  label: string
  color?: string
  persistent?: boolean
  layoutMode: LayoutMode
  panes: (string | null)[]
  focusedPane: number
}

/** The one group a snapshot carries: the live pane grid. */
export function singleViewGroup(layoutMode: LayoutMode, panes: (string | null)[], focusedPane: number): ViewGroup {
  return {
    id: DEFAULT_VIEW_GROUP_ID,
    label: 'Ungrouped',
    color: '#6b7280',
    persistent: true,
    layoutMode,
    panes: Array.from({ length: VIEW_GROUP_MAX_PLANES }, (_, index) => panes[index] ?? null),
    focusedPane,
  }
}
