import { useTabs } from '../../ide/editor/core/controller'
import { registerAction } from '../../ide/platform/actions'
import { setContext } from '../../ide/platform/context'
import { registerMenuSlotItem } from '../../ide/workbench/contributions'

import { sessionById, useSessionBridge } from './sessionBridge'
import { parseSessionInput } from './sessionInput'
import { showSessionTab } from './sessionTabActions'

/** The session of the active editor tab, when that tab is a session. */
export function activeSessionId(): string | null {
  const state = useTabs.getState()
  const pane = state.panes[state.activePane]
  const tab = pane?.tabs.find((item) => item.id === pane.active)
  return parseSessionInput(tab?.input)
}

const DETACHABLE = 'omniterm.sessionDetachable'
const DETACHED = 'omniterm.sessionDetached'

function updateContext(): void {
  const id = activeSessionId()
  const detach = id ? sessionById(id)?.detach ?? null : null
  setContext(DETACHABLE, detach === 'detach')
  setContext(DETACHED, detach === 'attach')
}

/**
 * Detach and reattach as actions on the editor's title toolbar, shown only while the active tab is
 * a session that can do it. The tab stays where it is while the session lives in its own window
 * (it shows a placeholder); reattaching focuses the tab again.
 */
export function registerSessionToolbar(): () => void {
  const toggle = (want: 'detach' | 'attach') => () => {
    const id = activeSessionId()
    if (!id || sessionById(id)?.detach !== want) return
    useSessionBridge.getState().api?.toggleDetach?.(id)
    if (want === 'attach') showSessionTab(id)
  }
  const disposers = [
    registerAction({ id: 'omniterm.session.detach', title: 'Detach Session into Its Own Window', category: 'Sessions', icon: 'external-link', when: DETACHABLE, verbatim: true, run: toggle('detach') }),
    registerAction({ id: 'omniterm.session.reattach', title: 'Attach Session Back into This Tab', category: 'Sessions', icon: 'external-link', when: DETACHED, verbatim: true, run: toggle('attach') }),
    registerMenuSlotItem('editor.title', { action: 'omniterm.session.detach', label: 'Detach session into its own window', verbatim: true, icon: 'external-link', when: DETACHABLE }),
    registerMenuSlotItem('editor.title', { action: 'omniterm.session.reattach', label: 'Attach session back into this tab', verbatim: true, icon: 'external-link', when: DETACHED }),
    useTabs.subscribe(updateContext),
    useSessionBridge.subscribe(updateContext),
  ]
  updateContext()
  return () => {
    disposers.reverse().forEach((dispose) => dispose())
    setContext(DETACHABLE, false)
    setContext(DETACHED, false)
  }
}
