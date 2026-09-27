import type React from 'react'
import { useRef } from 'react'

import type { QuotaWindow } from '../src/types'
import type { AgentIconConfig, LineSize } from './quotaConfig'
import { iconForAgent, type AgentBrand } from './agentBrand'

import { clampLimit, WINDOW_LABELS } from './quotaConfig'
import { animationFor, formatReset, lineTooltip, zoneBands, zoneFor } from './quotaPolicy'

export type { AgentBrand } from './agentBrand'

export function AgentIcon({ agent, icon, className = 'w-3 h-3' }: { agent: AgentBrand; icon?: AgentIconConfig; className?: string }) {
  if (icon?.mode === 'emoji' && icon.value) {
    return <span className={className} role="img" aria-label={`${agent} agent icon`}>{icon.value}</span>
  }
  const Icon = iconForAgent(agent)
  return <Icon className={className} />
}

interface QuotaLineProps {
  window: QuotaWindow
  limit: number
  animations: boolean
  showReset: boolean
  now: number
  /** Called with a new limit when the marker is dragged or nudged; omitted makes it read-only. */
  onLimitChange?: (limit: number) => void
  /** `thin` has no room for the marker's own number, so it's folded into `.aq-pct` instead. */
  size?: LineSize
  /** Appended to the computed tooltip — e.g. noting a sibling window that's hidden right now. */
  tooltipSuffix?: string
}

/**
 * One quota window: faint zone bands, the used fill coloured by zone, and a vertical limit marker.
 * The marker is a slider: drag it, or focus it and use the arrow keys (Shift for steps of 5).
 */
export function QuotaLine({ window, limit, animations, showReset, now, onLimitChange, size = 'normal', tooltipSuffix }: QuotaLineProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const zone = zoneFor(window.usedPct, limit)
  const animation = animationFor(zone, animations)
  const label = WINDOW_LABELS[window.kind]

  const limitAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return limit
    return clampLimit(((clientX - rect.left) / rect.width) * 100)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!onLimitChange) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!onLimitChange || !event.currentTarget.hasPointerCapture?.(event.pointerId)) return
    onLimitChange(limitAt(event.clientX))
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!onLimitChange) return
    const step = event.shiftKey ? 5 : 1
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') onLimitChange(clampLimit(limit - step))
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') onLimitChange(clampLimit(limit + step))
    else return
    event.preventDefault()
  }

  return (
    <div
      className={`aq-line aq-zone-${zone} aq-anim-${animation}`}
      title={tooltipSuffix ? `${lineTooltip(window, limit, now)}\n${tooltipSuffix}` : lineTooltip(window, limit, now)}
      data-testid={`aq-line-${window.kind}`}
      data-zone={zone}
      data-animation={animation}
      data-size={size}
    >
      <span className="aq-label">{label.short}</span>
      <div className="aq-track" ref={trackRef}>
        <span
          className="aq-used-container"
          style={{ clipPath: `inset(0 ${Math.max(0, 100 - Math.min(100, window.usedPct))}% 0 0 round 999px)` }}
        >
          {zoneBands(limit).map((band) => (
            <span
              key={band.zone}
              className={`aq-band aq-band-${band.zone}`}
              style={{ left: `${band.start}%`, width: `${band.end - band.start}%` }}
            />
          ))}
          <span className="aq-fill" style={{ width: `${Math.min(100, window.usedPct)}%` }} />
        </span>
        <span className="aq-track-current aq-track-value" aria-label={`${label.long} current usage`}>{Math.round(window.usedPct)}%</span>
        <span className="aq-track-remaining" aria-label={`${label.long} remaining to limit`}>{Math.max(0, Math.round(limit - window.usedPct))}%</span>
        <span className="aq-marker" style={{ left: `${limit}%` }} />
        {onLimitChange && (
          <button
            type="button"
            role="slider"
            aria-label={`${label.long} limit`}
            aria-valuemin={5}
            aria-valuemax={100}
            aria-valuenow={limit}
            className="aq-marker-handle"
            style={{ left: `${limit}%` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onKeyDown={onKeyDown}
          />
        )}
      </div>
      {showReset && <span className="aq-reset">{formatReset(window.resetsAt, now)}</span>}
    </div>
  )
}
