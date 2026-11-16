import { dockStripSide } from '../features/agent-quota/quotaDock'

import { toggleQuotaPopup, useQuotaDock, useQuotaPopup } from './quota/quotaDockState'
import { usageColor } from './quota/quotaModel'
import { useQuotaGroups } from './quota/useQuotaGroups'
import './quota/quotaWorkbench.css'

/**
 * The quota status line on a tool window stripe (Display: left / right tab strip): one tiny
 * vertical bar per agent for the active session's profile, or each agent's first profile; a click
 * opens the details popup. Without `side` (an older mount at the stripe's foot) it renders nothing:
 * the stripe item registered by `registerQuotaWorkbench` places it under the stripe's top group.
 */
export function QuotaStripVertical({ side }: { side?: 'left' | 'right' }) {
  const dock = useQuotaDock()
  const open = useQuotaPopup((s) => s.open)
  const { groups } = useQuotaGroups()
  if (!side || dockStripSide(dock) !== side || groups.length === 0) return null

  return (
    <button
      type="button"
      className="omt-q-stripe"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label="Agent quota: click for all profiles"
      title="Agent quota: click for all profiles"
      onClick={toggleQuotaPopup}
      data-feature="p2.plugins.agentQuota.stripe"
      data-testid="quota-strip-vertical"
    >
      {groups.map((group) => {
        const { pct } = group.shown
        return (
          <div
            key={group.agent}
            className="omt-q-stripe-item"
            data-active={group.active || undefined}
            title={`${group.name} / ${group.shown.name}: ${pct === null ? 'no reading yet' : `${pct}%`} · ${group.shown.detail}`}
          >
            <span>{group.tag}</span>
            <div className="omt-q-stripe-bar">
              <i style={{ height: `${pct ?? 0}%`, background: usageColor(pct) }} />
            </div>
            <span>{pct === null ? '–' : pct}</span>
          </div>
        )
      })}
    </button>
  )
}
