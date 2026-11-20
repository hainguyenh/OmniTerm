import { useMemo, type ReactNode } from 'react'

import './agentQuota.css'
import './footerMeters.css'
import { footerMeters, footerRisk } from './footerMeterModel'
import { useCoarseNow, useQuota } from './quotaStore'

/**
 * The left of an agent pane's footer: the profile's 5-hour and weekly quota and the conversation's
 * context as short bars with their numbers, coloured like the quota lines. `fallback` shows while
 * there is no bar to draw.
 */
export function FooterMeters({ sessionId, contextPct, title, fallback = null }: {
  sessionId: string
  contextPct: number | null
  title?: string
  fallback?: ReactNode
}) {
  const config = useQuota((state) => state.config)
  const terminals = useQuota((state) => state.terminals)
  const profiles = useQuota((state) => state.profiles)
  const overrides = useQuota((state) => state.overrides)
  // Only the reset times in the tooltips move with the clock; a coarse one is enough.
  const now = useCoarseNow()
  const meters = useMemo(
    () => footerMeters({ config, terminals, profiles, overrides }, sessionId, contextPct, now),
    [config, terminals, profiles, overrides, sessionId, contextPct, now],
  )
  const risk = useMemo(() => footerRisk({ config, terminals, profiles }, sessionId), [config, terminals, profiles, sessionId])
  if (meters.length === 0) return fallback
  return (
    <span className="aq-meters" title={title} data-testid="agent-footer-meters">
      {risk && (
        <span className="aq-risk aq-zone-hot" title={risk.title} data-testid="agent-footer-risk">{risk.text}</span>
      )}
      {meters.map((meter) => (
        <span
          key={meter.key}
          className={`aq-meter aq-zone-${meter.zone}`}
          title={meter.title}
          data-testid={`agent-footer-meter-${meter.key}`}
          data-zone={meter.zone}
        >
          <span className="aq-meter-label">{meter.label}</span>
          <span className="aq-meter-track" role="meter" aria-label={meter.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter.pct}>
            <span className="aq-meter-fill" style={{ width: `${meter.pct}%` }} />
          </span>
          <span className="aq-meter-value">{meter.pct}%</span>
        </span>
      ))}
    </span>
  )
}
