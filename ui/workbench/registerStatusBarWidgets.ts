import { registerStatusItem } from '../ide/workbench/contributions'

import { StatusBarQuotaChips } from './StatusBarQuotaChips'
import { StatusBarSessionWidget } from './StatusBarSessionWidget'

/**
 * Registers OmniTerm status bar widgets next to the IDE's own, which follow IDEA's new UI: left,
 * the navigation bar (a session tab's `project › folder › shell` included, see `sessionPlaces`),
 * then the quota chips; right, background tasks, the active session, caret, line ending, encoding
 * and indent (priorities 20–50), the language servers. The Git branch lives in the title bar and
 * notifications in the right tool window stripe, as in IDEA, so the bar repeats neither.
 * - `omniterm.quotaChips`: Agent quota chips (footer dock), aligned with the editor's left edge.
 * - `omniterm.sessionInfo`: the active session tab's agent model, link metrics and reconnect; it
 *   takes the editor widgets' place while a session tab is active (they show nothing then).
 */
export function registerStatusBarWidgets(): () => void {
  const disposers = [
    registerStatusItem({
      id: 'omniterm.quotaChips',
      title: 'Agent Quota',
      align: 'left',
      priority: -1,
      component: StatusBarQuotaChips,
    }),
    registerStatusItem({
      id: 'omniterm.sessionInfo',
      title: 'Active Session',
      align: 'right',
      priority: 10,
      component: StatusBarSessionWidget,
    }),
  ]

  return () => {
    disposers.reverse().forEach((dispose) => dispose())
  }
}
