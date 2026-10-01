import type React from 'react'
import { useRef } from 'react'

import { DEFAULT_QUOTA_CONFIG, effectiveConfig } from './quotaConfig'
import { resolvePaceArt, usePaceCustomArt } from './headerLoadingArt'
import { HEADER_TIER_BOUNDS, headerLoadingTier, isBlazingQuota } from './quotaPolicy'
import { useQuota } from './quotaStore'
import { ArtBlaze } from './ArtBlaze'
import { useArtDistanceFactor } from './artDistance'

import './headerBusyArt.css'

const TIER_LABELS = {
  slow: `under ${HEADER_TIER_BOUNDS.slow}% of the limit used`,
  onTrack: `under ${HEADER_TIER_BOUNDS.onTrack}% of the limit used`,
  fast: `under ${HEADER_TIER_BOUNDS.fast}% of the limit used`,
  overshooting: `over ${HEADER_TIER_BOUNDS.fast}% of the limit used`,
} as const

/**
 * The busy animation inside a pane header's activity zone. With "Agent loading artwork" on
 * (Settings → Agent Quota), a busy agent pane shows its pace artwork — the user's upload for that
 * tier, else the built-in GIF — travelling across the whole zone; otherwise `fallback` (the plain
 * running dots) is shown. The zone's size is fixed by the header, so switching between the two
 * never moves a button.
 */
export function HeaderBusyArt({
  sessionId,
  darkMode = true,
  fallback,
}: {
  sessionId: string
  darkMode?: boolean
  fallback: React.ReactNode
}) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const distanceFactor = useArtDistanceFactor(containerRef)
  const display = useQuota((state) => state.config.display)
  const terminal = useQuota((state) => state.terminals[sessionId])
  const global = useQuota((state) => (terminal ? state.config.agents[terminal.agent] : undefined))
  const override = useQuota((state) => (terminal ? state.overrides[terminal.instanceKey] : undefined))
  const profile = useQuota((state) => (terminal ? state.profiles[terminal.profileKey] : undefined))
  const { paceArt } = usePaceCustomArt()

  if (!display.customArtSession || !display.animations) return <>{fallback}</>

  const config = global && effectiveConfig(global, override)
  const session = profile?.lastGood?.windows.find((window) => window.kind === 'session')
  const limit = config?.limits.session ?? DEFAULT_QUOTA_CONFIG.agents.claude.limits.session
  const tier = headerLoadingTier(session, limit)
  const isBlazing = isBlazingQuota(session, limit, profile?.lastGood?.windows)
  const label = `Processing · ${TIER_LABELS[tier]}`
  const blazingClass = isBlazing ? ' aq-busy-art-blazing' : ''
  return (
    <span
      ref={containerRef}
      className={`aq-busy-art aq-busy-art-${tier} aq-art-size-${display.artSize ?? 'normal'} aq-art-speed-${display.artSpeed ?? 'normal'}${blazingClass}`}
      role="status"
      aria-label={label}
      data-loading-tier={tier}
      data-blazing={isBlazing ? 'true' : undefined}
      style={distanceFactor !== undefined ? ({ '--aq-art-distance-factor': distanceFactor } as React.CSSProperties) : undefined}
    >
      <img src={resolvePaceArt(tier, darkMode ? 'dark' : 'light', paceArt)} alt="" aria-hidden="true" draggable="false" />
      {isBlazing && <ArtBlaze />}
    </span>
  )
}
