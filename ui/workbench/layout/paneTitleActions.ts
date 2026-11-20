import { registerAction } from '../../ide/platform/actions'
import { provideEmptyPane, registerMenuSlotItem } from '../../ide/workbench/contributions'
import { omnitermActionId } from '../../platform/omnitermActions'
import { EmptyPaneLauncher } from '../sessions/EmptyPaneLauncher'
import { NEW_SESSION_IN_PANE, openPaneQuickStart } from '../sessions/paneQuickStartStore'

/** The action that maximizes the active pane, or restores the layout from a maximized one. */
export const TOGGLE_MAXIMIZE_PANE = 'omniterm.toggleMaximizePane'

/**
 * The buttons of every pane. Maximize acts on the editor shown, so it floats with the editor's
 * actions at its top-right corner (`editor.title`); the new session ends the pane's tab strip
 * (`editor.pane`). An empty pane of a split layout (a split of a session tab is one) shows the
 * session launcher inline: the project, then the terminal (default) or an agent. The floating
 * picker stays an action ("New Session in This Pane…") for the command palette and shortcuts.
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
    provideEmptyPane(EmptyPaneLauncher),
  ]
  return () => disposers.reverse().forEach((dispose) => dispose())
}
