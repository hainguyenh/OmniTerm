import { useTabs } from '../../ide/editor/core/controller'
import { parseSessionInput } from '../sessions/sessionInput'

/** The session of the active editor tab, or null while the active tab is not a session. */
export function useActiveSessionId(): string | null {
  return useTabs((state) => {
    const pane = state.panes[state.activePane]
    return parseSessionInput(pane?.tabs.find((tab) => tab.id === pane.active)?.input)
  })
}
