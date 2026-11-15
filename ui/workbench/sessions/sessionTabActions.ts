import { diag } from '../../diag'
import { editorController, useTabs } from '../../ide/editor/core/controller'
import { editorService } from '../../ide/workbench/contributions'

import { sessionInput } from './sessionInput'

/** Shows a session: activates its tab (any pane), or opens one when it has none. */
export function showSessionTab(sessionId: string): void {
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
