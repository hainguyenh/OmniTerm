import { registerAction } from '../../ide/platform/actions'
import { registerMenuSlotItem } from '../../ide/workbench/contributions'
import { omnitermActionId } from '../../platform/omnitermActions'
import { NEW_SESSION_IN_PANE, openPaneQuickStart } from '../sessions/paneQuickStartStore'

/** The action that maximizes the active pane, or restores the layout from a maximized one. */
export const TOGGLE_MAXIMIZE_PANE = 'omniterm.toggleMaximizePane'

/**
 * The buttons of every pane. Maximize acts on the editor shown, so it floats with the editor's
 * actions at its top-right corner (`editor.title`); the new session ends the pane's tab strip
 * (`editor.pane`). An empty pane of a split layout (a split of a session tab is one) offers a
 * button that opens the session picker: the project, then a terminal or an agent (`editor.emptyPane`).
 */
export function registerPaneTitleActions(): () => void {
  const disposers = [
    registerMenuSlotItem('editor.title', {
      action: TOGGLE_MAXIMIZE_PANE,
      label: 'Maximize / restore this pane',
      verbatim: true,
      icon: 'fullscreen',
    }),
    registerMenuSlotItem('editor.pane', {
      action: omnitermActionId('newSession'),
      label: 'New terminal or agent session in this pane',
      verbatim: true,
      icon: 'plus',
    }),
    registerAction({
      id: NEW_SESSION_IN_PANE,
      title: 'New Session in This Pane…',
      category: 'Sessions',
      verbatim: true,
      run: openPaneQuickStart,
    }),
    registerMenuSlotItem('editor.emptyPane', {
      action: NEW_SESSION_IN_PANE,
      label: 'New session…',
      verbatim: true,
    }),
  ]
  return () => disposers.reverse().forEach((dispose) => dispose())
}
