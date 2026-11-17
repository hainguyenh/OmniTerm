import { diag } from '../../diag'
import { editorController, useTabs } from '../../ide/editor/core/controller'
import { editorService, toolWindowService } from '../../ide/workbench/contributions'
import { TERMINAL_WINDOW } from '../terminalDock/terminalDockActions'
import { isDocked, selectDocked } from '../terminalDock/terminalDockStore'

import { sessionInput } from './sessionInput'

/**
 * Shows a session where it lives: a session docked in the Terminal tool window is selected there,
 * any other activates its tab (any pane), or opens one when it has none.
 */
export function showSessionTab(sessionId: string): void {
  if (isDocked(sessionId)) {
    selectDocked(sessionId)
    toolWindowService().show(TERMINAL_WINDOW)
    return
  }
  const input = sessionInput(sessionId)
  for (const pane of Object.values(useTabs.getState().panes)) {
    const tab = pane.tabs.find((item) => item.input.key === input.key)
    if (tab) {
      editorController().activate(pane.id, tab.id)
      return
    }
  }
  editorService()
    .openInput(input, { focus: true })
    .catch((error: unknown) => diag.warn('[sessions] could not open the session tab', error))
}
