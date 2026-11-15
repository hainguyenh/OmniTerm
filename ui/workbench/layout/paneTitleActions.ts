import { registerMenuSlotItem } from '../../ide/workbench/contributions'
import { omnitermActionId } from '../../platform/omnitermActions'

/** The action that maximizes the active pane, or restores the layout from a maximized one. */
export const TOGGLE_MAXIMIZE_PANE = 'omniterm.toggleMaximizePane'

/**
 * The buttons of every pane. Maximize acts on the editor shown, so it floats with the editor's
 * actions at its top-right corner (`editor.title`); the new session ends the pane's tab strip
 * (`editor.pane`). An empty pane of a split layout offers the new session as a button too
 * (`editor.emptyPane`).
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
    registerMenuSlotItem('editor.emptyPane', {
      action: omnitermActionId('newSession'),
      label: 'New session',
      verbatim: true,
    }),
  ]
  return () => disposers.reverse().forEach((dispose) => dispose())
}
