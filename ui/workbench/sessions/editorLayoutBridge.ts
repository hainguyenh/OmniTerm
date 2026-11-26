import { LAYOUT_MODES, type LayoutMode } from '../../themes'
import type { TabsState } from '../../ide/editor/core/model/tabs'
import { paneIds } from '../../ide/editor/core/model/tabs'
import { VIEW_GROUP_MAX_PLANES } from '../../viewGroups'

import { parseSessionInput } from './sessionInput'

export interface DerivedGrid {
  layoutMode: LayoutMode
  /** Session id shown by each editor pane, in layout order; null for a pane showing no session. */
  panes: (string | null)[]
  focusedPane: number
}

/**
 * The legacy pane grid (`layoutMode`, `panes`, `focusedPane`) as the editor shows it, so session
 * snapshots keep carrying a layout that older builds can read. A pane maps to the session its
 * active tab shows, else its first session tab.
 */
export function deriveGrid(state: TabsState): DerivedGrid {
  const ids = paneIds(state).slice(0, VIEW_GROUP_MAX_PLANES)
  const panes: (string | null)[] = Array.from({ length: VIEW_GROUP_MAX_PLANES }, () => null)
  ids.forEach((paneId, index) => {
    const pane = state.panes[paneId]
    const active = pane?.tabs.find((tab) => tab.id === pane.active)
    const own = parseSessionInput(active?.input)
      ?? pane?.tabs.map((tab) => parseSessionInput(tab.input)).find((id) => id !== null)
      ?? null
    panes[index] = own
  })
  const wanted = Math.max(1, ids.length)
  const layoutMode = LAYOUT_MODES.find((mode) => mode >= wanted) ?? LAYOUT_MODES[LAYOUT_MODES.length - 1]
  return { layoutMode, panes, focusedPane: Math.max(0, ids.indexOf(state.activePane)) }
}
