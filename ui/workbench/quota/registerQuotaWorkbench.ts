import { dockToolWindowSide } from '../../features/agent-quota/quotaDock'
import { getQuotaState, subscribeQuota } from '../../features/agent-quota/quotaStore'
import { registerOverlay, registerToolWindow } from '../../ide/workbench/contributions'
import { registerStripeItem } from '../../ide/workbench/toolwindows/stripeItems'
import { QuotaStripVertical } from '../QuotaStripVertical'

import { effectiveDock, QUOTA_TOOL_WINDOW } from './quotaDockState'
import { QUOTA_ICON, registerQuotaIcons } from './quotaIcons'
import { QuotaDockButtons, QuotaToolWindow } from './QuotaPanel'
import { QuotaPopover } from './QuotaPopover'

/**
 * The Agent quota tool window, on the side its dock names: left between Bookmarks and Sessions,
 * right under Notifications. Re-registered when the dock changes; absent for the other docks.
 */
function trackQuotaToolWindow(): () => void {
  let side: 'left' | 'right' | null = null
  let dispose: (() => void) | null = null
  const sync = () => {
    const next = dockToolWindowSide(effectiveDock(getQuotaState()))
    if (next === side) return
    dispose?.()
    dispose = null
    side = next
    if (!next) return
    dispose = registerToolWindow({
      id: QUOTA_TOOL_WINDOW,
      title: 'Agent quota',
      icon: QUOTA_ICON,
      anchor: next,
      order: next === 'left' ? 30.5 : 0.25,
      requiresProject: false,
      component: QuotaToolWindow,
      headerActions: QuotaDockButtons,
    })
  }
  sync()
  const unsubscribe = subscribeQuota(sync)
  return () => {
    unsubscribe()
    dispose?.()
  }
}

/** Agent quota in the workbench: tool window, tab strip line, details popup (footer chips: status bar). */
export function registerQuotaWorkbench(): () => void {
  const disposers = [
    registerQuotaIcons(),
    trackQuotaToolWindow(),
    registerStripeItem({ id: 'omniterm.agentQuota.stripe', component: QuotaStripVertical }),
    registerOverlay({ id: 'omniterm.agentQuota.popover', component: QuotaPopover }),
  ]
  return () => disposers.reverse().forEach((dispose) => dispose())
}
