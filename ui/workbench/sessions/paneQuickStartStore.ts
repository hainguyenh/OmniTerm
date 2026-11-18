import { create } from 'zustand'

import { useTabs } from '../../ide/editor/core/controller'
import { setActivePane } from '../../ide/editor/core/model/tabs'

/** The action of an empty pane's "New session…" button. */
export const NEW_SESSION_IN_PANE = 'omniterm.newSessionInPane'

interface PaneQuickStartTarget {
  /** The pane the started session opens in. */
  paneId: string
  /** Viewport point of the picker's top-left corner. */
  at: { x: number; y: number }
}

interface PaneQuickStartState {
  target: PaneQuickStartTarget | null
}

/** The session picker an empty pane opened, if any: one at a time. */
export const usePaneQuickStart = create<PaneQuickStartState>(() => ({ target: null }))

const PICKER_WIDTH = 340

/** Near the top of the pane, centred: where its "New session…" button sits. */
function anchorOf(paneId: string): { x: number; y: number } {
  const rect = document.querySelector(`[data-pane-id="${CSS.escape(paneId)}"]`)?.getBoundingClientRect()
  if (!rect) return { x: 48, y: 72 }
  return { x: rect.left + Math.max(0, (rect.width - PICKER_WIDTH) / 2), y: rect.top + Math.min(96, rect.height / 4) }
}

/** Opens the session picker (project, then terminal or agent) for the active pane. */
export function openPaneQuickStart(): void {
  const paneId = useTabs.getState().activePane
  usePaneQuickStart.setState({ target: { paneId, at: anchorOf(paneId) } })
}

export function closePaneQuickStart(): void {
  usePaneQuickStart.setState({ target: null })
}

/**
 * Makes the picker's pane the active one again just before the session starts, so its new tab
 * opens there even when the user clicked elsewhere while the picker was open.
 */
export function focusPickerPane(paneId: string): void {
  const tabs = useTabs.getState()
  if (tabs.panes[paneId] && tabs.activePane !== paneId) useTabs.setState(setActivePane(tabs, paneId), true)
}
