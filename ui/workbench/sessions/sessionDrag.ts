import { diag } from '../../diag'
import { editorController, useTabs } from '../../ide/editor/core/controller'
import { registerEditorDropHandler, editorService } from '../../ide/workbench/contributions'

import { sessionById } from './sessionBridge'
import { parseSessionInput, sessionInput } from './sessionInput'

/** Drag type of a Sessions tool window row dragged onto an editor pane. */
export const SESSION_DRAG = 'application/x-omniterm-session'

/** The session id a drag payload names, when it is a plain id of a session of this window. */
export function sessionFromDrag(payload: string): string | null {
  const id = parseSessionInput(sessionInput(payload))
  return id !== null && sessionById(id) ? id : null
}

/**
 * Drops a Sessions panel row on a pane: the session's tab moves into that pane (the pane was made
 * active by the drop), keeping its terminal; a session without a tab gets one there. The payload
 * is untrusted: only ids of live sessions of this window are accepted.
 */
export function registerSessionDropHandler(): () => void {
  return registerEditorDropHandler({
    accepts: (type) => type === SESSION_DRAG,
    drop: ({ payload }) => {
      const id = sessionFromDrag(payload)
      if (!id) return
      const state = useTabs.getState()
      const key = sessionInput(id).key
      const home = Object.values(state.panes).find((pane) => pane.tabs.some((tab) => tab.input.key === key))
      const tab = home?.tabs.find((item) => item.input.key === key)
      const target = state.panes[state.activePane]
      if (home && tab && target) {
        if (home.id === target.id) editorController().activate(home.id, tab.id)
        else editorController().moveTab(home.id, tab.id, target.id, target.tabs.length)
        return
      }
      editorService()
        .openInput(sessionInput(id), { focus: true })
        .catch((error: unknown) => diag.warn('[sessions] could not open the dropped session', error))
    },
  })
}
