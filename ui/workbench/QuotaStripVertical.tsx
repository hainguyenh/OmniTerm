import { dockStripSide } from '../features/agent-quota/quotaDock'

import { toggleQuotaPopup, useQuotaDock, useQuotaPopup } from './quota/quotaDockState'
import { usageColor } from './quota/quotaModel'
import { useQuotaGroups } from './quota/useQuotaGroups'
import './quota/quotaWorkbench.css'

const RING_SIZE = 24
const RING_STROKE = 3
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

/**
 * One agent's used share as a ring: the arc grows clockwise from the top, the number sits inside.
 * The SVG carries its own size and colours, so it reads the same on a narrow stripe of any width.
 */
function QuotaRing({ pct }: { pct: number | null }) {
  const used = Math.min(100, Math.max(0, pct ?? 0))
  const centre = RING_SIZE / 2
  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      className="omt-q-ring"
      aria-hidden="true"
      data-testid="quota-ring"
      data-pct={pct ?? ''}
    >
      <circle cx={centre} cy={centre} r={RING_RADIUS} fill="none" stroke="var(--border-strong)" strokeWidth={RING_STROKE} />
      {pct !== null && (
        <circle
          cx={centre}
          cy={centre}
          r={RING_RADIUS}
          fill="none"
          stroke={usageColor(pct)}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={`${(used / 100) * RING_LENGTH} ${RING_LENGTH}`}
          transform={`rotate(-90 ${centre} ${centre})`}
        />
      )}
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="omt-q-ring-pct">
        {pct === null ? '–' : Math.round(pct)}
      </text>
    </svg>
  )
}

/**
 * Agent quota on a tool window stripe (Display: left / right tab strip): one ring per agent for
 * the active session's profile, or each agent's first profile, with the agent's tag under it; a
 * click opens the details popup. Without `side` (an older mount at the stripe's foot) it renders
 * nothing: the stripe item registered by `registerQuotaWorkbench` places it under the top group.
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
          <span
            key={group.agent}
            className="omt-q-stripe-item"
            data-active={group.active || undefined}
            title={`${group.name} / ${group.shown.name}: ${pct === null ? 'no reading yet' : `${pct}%`} · ${group.shown.detail}`}
          >
            <QuotaRing pct={pct} />
            <span>{group.tag}</span>
          </span>
        )
      })}
    </button>
  )
}
