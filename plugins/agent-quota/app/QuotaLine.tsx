import type React from 'react'
import { useRef } from 'react'

import type { QuotaWindow } from '../src/types'
import type { LineSize } from './quotaConfig'
import { iconForAgent, type AgentBrand } from './agentBrand'

import { clampLimit, WINDOW_LABELS } from './quotaConfig'
import { animationFor, formatReset, lineTooltip, trackLabels, zoneFor } from './quotaPolicy'

export type { AgentBrand } from './agentBrand'

export function AgentIcon({ agent, className = 'w-3 h-3' }: { agent: AgentBrand; className?: string }) {
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
  /** Track height; the numbers inside scale with it. */
  size?: LineSize
  /** Appended to the computed tooltip — e.g. noting a sibling window that's hidden right now. */
  tooltipSuffix?: string
}

/**
 * One quota window, as `[ used | remaining safe | danger zone ]`: the safe range runs up to the
 * limit marker, the danger zone from the limit to 100%. Both unused ranges share the track's own
 * background — the marker is the boundary. The fill's colour is the zone of used ÷ limit, so moving
 * the limit re-colours it immediately. The used % is centred in the fill and the danger zone's size
 * centred in the danger zone — or, when the zone is too narrow for it, just after the track. The limit marker is a slider: drag it, or focus it and use the arrow
 * keys (Shift for steps of 5).
 */
export function QuotaLine({ window, limit, animations, showReset, now, onLimitChange, size = 'normal', tooltipSuffix }: QuotaLineProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const zone = zoneFor(window.usedPct, limit)
  const animation = animationFor(zone, animations)
  const label = WINDOW_LABELS[window.kind]
  const labels = trackLabels(window.usedPct, limit)

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
        <span className="aq-used-container">
          <span className="aq-fill" style={{ width: `${labels.used.fill}%` }} />
        </span>
        <span
          className={`aq-track-value aq-used-value${labels.used.inside ? '' : ' aq-used-value-outside'}`}
          style={{ left: `${labels.used.at}%` }}
          aria-label={`${label.long} current usage`}
        >
          {labels.used.text}
        </span>
        {labels.danger?.inside && (
          <span className="aq-track-value aq-danger-value" style={{ left: `${labels.danger.at}%` }} aria-label={`${label.long} danger zone above the limit`}>
            {labels.danger.text}
          </span>
        )}
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
      {labels.danger && !labels.danger.inside && (
        <span className="aq-track-value aq-danger-value aq-danger-value-outside" aria-label={`${label.long} danger zone above the limit`}>
          {labels.danger.text}
        </span>
      )}
      {showReset && <span className="aq-reset">{formatReset(window.resetsAt, now)}</span>}
    </div>
  )
}
