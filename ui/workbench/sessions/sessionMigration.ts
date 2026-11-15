import { openTab, paneIds, type TabsState } from '../../ide/editor/core/model/tabs'
import { applyPreset, presetDef, presetForPaneCount, type PresetId } from '../layout/layoutPresets'

import type { LegacyLayout } from './sessionBridge'
import { sessionInput } from './sessionInput'

export interface LegacyPlacement {
  /** The preset the old `layoutMode` maps to (its pane count is the closest one that holds the grid). */
  preset: PresetId
  /** Which editor pane (0-based, in layout order) shows which session. */
  assignments: { sessionId: string; pane: number }[]
  focusedPane: number
}

/**
 * Turns the pane grid an old snapshot carried into editor panes: the grid's `layoutMode` becomes the
 * preset with that many panes, and pane N of the grid becomes the Nth editor pane holding that
 * session's tab. Empty grid panes stay empty editor panes, so a 2x2 grid is still a 2x2 grid.
 * Sessions the grid did not show are left to the reconciler.
 */
export function planLegacyPlacement(layout: LegacyLayout, liveSessionIds: ReadonlySet<string>): LegacyPlacement | null {
  const preset = presetForPaneCount(layout.layoutMode)
  const slots = presetDef(preset).panes
  const assignments: LegacyPlacement['assignments'] = []
  const seen = new Set<string>()
  layout.panes.slice(0, Math.min(layout.layoutMode, slots)).forEach((id, pane) => {
    if (!id || !liveSessionIds.has(id) || seen.has(id)) return
    seen.add(id)
    assignments.push({ sessionId: id, pane })
  })
  if (assignments.length === 0) return null
  const focusedPane = layout.focusedPane >= 0 && layout.focusedPane < slots ? layout.focusedPane : 0
  return { preset, assignments, focusedPane }
}

/**
 * Applies a placement to an editor that has no tabs at all (the only case where building panes
 * does not have to lend them tabs). Returns null when tabs exist already.
 */
export function applyLegacyPlacement(current: TabsState, plan: LegacyPlacement): TabsState | null {
  if (Object.values(current.panes).some((pane) => pane.tabs.length > 0)) return null
  let state = applyPreset(current, plan.preset)
  const panes = paneIds(state)
  for (const { sessionId, pane } of plan.assignments) {
    const target = panes[pane]
    if (target) state = openTab(state, target, sessionInput(sessionId), { activate: false }).state
  }
  const focus = panes[plan.focusedPane] ?? panes[0]!
  return { ...state, activePane: focus }
}
