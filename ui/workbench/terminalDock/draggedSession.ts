import { useTabs } from '../../ide/editor/core/controller'
import { EDITOR_TAB_MIME } from '../../ide/workbench/contributions'
import { SESSION_DRAG, sessionFromDrag } from '../sessions/sessionDrag'
import { parseSessionInput } from '../sessions/sessionInput'

/**
 * The session a drag onto the window carries: an editor tab of a session (its `{paneId, tabId}`
 * payload), or a Sessions panel row. Payloads are untrusted; only live sessions are returned.
 */
export function draggedSession(type: string, payload: string): string | null {
  if (type === SESSION_DRAG) return sessionFromDrag(payload)
  if (type !== EDITOR_TAB_MIME) return null
  try {
    const { paneId, tabId } = JSON.parse(payload) as { paneId?: unknown; tabId?: unknown }
    if (typeof paneId !== 'string' || typeof tabId !== 'string') return null
    const tab = useTabs.getState().panes[paneId]?.tabs.find((item) => item.id === tabId)
    const id = tab ? parseSessionInput(tab.input) : null
    return id ? sessionFromDrag(id) : null
  } catch {
    return null
  }
}
