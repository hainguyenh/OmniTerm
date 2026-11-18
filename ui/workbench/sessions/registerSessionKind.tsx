import { registerEditorKind, notifyTabTitlesChanged } from '../../ide/workbench/contributions'

import { sessionById, useSessionBridge } from './sessionBridge'
import { confirmSessionClose, onSessionTabClosed } from './sessionClose'
import { SESSION_KIND, parseSessionInput } from './sessionInput'
import { registerSessionTabFeatures } from './registerSessionTabFeatures'
import { registerAgentTabIcons, sessionIconName } from './sessionIcons'
import { registerSessionPlaces } from './sessionPlaces'
import { SessionTab } from './SessionTab'
import { SessionTabStatus } from './SessionTabStatus'
import { agentProfileOf, sessionTabTitle } from './sessionTabTitle'

/**
 * Registers the session editor kind. Its tab is the mock's: icon, title (the agent profile for an
 * agent) and a transient status dot; the session colour is picked in the Sessions tool window. Closing the last tab of a session kills it (`onClose`), after
 * `confirmClose` asked when something still runs. Only the session id is saved with the editor
 * session, and the tab-limit never evicts a session.
 */
export function registerSessionKind(): () => void {
  const unregister = registerEditorKind({
    kind: SESSION_KIND,
    component: SessionTab,
    title: (input) => {
      const id = parseSessionInput(input)
      return sessionTabTitle(id ? sessionById(id) : undefined, agentProfileOf(id))
    },
    icon: (input) => sessionIconName(parseSessionInput(input)),
    trailing: (input) => {
      const id = parseSessionInput(input)
      return id ? <SessionTabStatus sessionId={id} /> : null
    },
    restorable: true,
    keepAlive: true,
    exemptFromTabLimit: true,
    // A copy of a live session would start a second shell; the empty pane offers the session picker.
    splitOpensEmpty: true,
    confirmClose: confirmSessionClose,
    onClose: onSessionTabClosed,
  })
  // Titles are read from the registry, so a renamed session (OSC title) or one that changed folder
  // refreshes its tab label.
  let names = ''
  const unsubscribe = useSessionBridge.subscribe((state) => {
    const next = state.sessions.map((session) => `${session.id}\u0000${session.name}\u0000${session.cwd ?? ''}`).join('\u0001')
    if (next === names) return
    names = next
    notifyTabTitlesChanged()
  })
  const stopFeatures = registerSessionTabFeatures()
  const stopIcons = registerAgentTabIcons()
  const stopPlaces = registerSessionPlaces()
  return () => {
    stopPlaces()
    stopIcons()
    stopFeatures()
    unsubscribe()
    unregister()
  }
}
