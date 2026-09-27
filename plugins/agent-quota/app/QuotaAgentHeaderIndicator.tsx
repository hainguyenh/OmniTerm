import { agentBrandFromName } from './agentBrand'
import { AgentIcon } from './QuotaLine'
import { DEFAULT_QUOTA_CONFIG, effectiveConfig } from './quotaConfig'
import { HEADER_LOADING_ART, resolvePaceArt, usePaceCustomArt } from './headerLoadingArt'
import { headerLoadingTier } from './quotaPolicy'
import { useQuota } from './quotaStore'

import './headerLoadingArt.css'

const TIER_LABELS = {
  slow: 'slow burn',
  onTrack: 'on-track burn',
  fast: 'fast burn',
  overshooting: 'critical burn',
} as const

/** Shared quota/agent visual placed beside the header's running-process indicator. */
export function QuotaAgentHeaderIndicator({
  sessionId,
  agentName,
  loadingArtUrl,
  sessionArtUrl,
  busy = false,
  darkMode = true,
}: {
  sessionId: string
  agentName?: string
  loadingArtUrl?: string | null
  sessionArtUrl?: string | null
  busy?: boolean
  darkMode?: boolean
}) {
  const enabled = useQuota((state) => state.config.enabled)
  const display = useQuota((state) => state.config.display)
  const terminal = useQuota((state) => state.terminals[sessionId])
  const global = useQuota((state) => (terminal ? state.config.agents[terminal.agent] : undefined))
  const override = useQuota((state) => (terminal ? state.overrides[terminal.instanceKey] : undefined))
  const config = global && effectiveConfig(global, override)
  const profile = useQuota((state) => (terminal ? state.profiles[terminal.profileKey] : undefined))
  const now = useQuota((state) => state.now)
  const brand = terminal?.agent ?? agentBrandFromName(agentName)
  const session = profile?.lastGood?.windows.find((window) => window.kind === 'session')
  const loadingTier = headerLoadingTier(session, config?.limits.session ?? DEFAULT_QUOTA_CONFIG.agents.claude.limits.session, now)
  const { paceArt } = usePaceCustomArt()

  // Busy is a terminal-header concern, not a quota-monitor concern. Keep the converted artwork
  // visible while an agent is still being detected, while quota is disabled, or while its first
  // reading is pending; the quota profile only refines the selected pace tier.
  if (busy && display.animations) {
    const mode = darkMode ? 'dark' : 'light'
    const label = brand ? `Processing · ${TIER_LABELS[loadingTier]}` : 'Running process'
    const customArt = display.customArtSession ? resolvePaceArt(loadingTier, mode, paceArt, sessionArtUrl) : null
    const artSpeed = display.artSpeed ?? 'normal'
    const artSize = display.artSize ?? 'normal'
    return (
      <span
        className={`aq-agent-header-icon aq-agent-header-loading aq-agent-header-loading-${loadingTier} aq-art-size-${artSize} aq-art-speed-${artSpeed}`}
        data-loading-tier={loadingTier}
        data-art-size={artSize}
        data-art-speed={artSpeed}
        role="status"
        aria-label={label}
        title={label}
        data-art-source={customArt ? 'custom' : 'default'}
      >
        <span className="aq-agent-header-loading-travel">
          <img src={customArt ?? HEADER_LOADING_ART[loadingTier][mode]} alt="" aria-hidden="true" draggable="false" />
        </span>
      </span>
    )
  }

  if (!brand) return null
  if (!enabled || (terminal && !config?.enabled)) {
    return (
      <span className="aq-agent-header-icon aq-agent-header-muted" role="status" aria-label={`${agentName ?? brand} agent; quota monitor off`} title="Quota monitor is off for this terminal">
        <AgentIcon agent={brand} className="h-3.5 w-3.5" />
      </span>
    )
  }
  if (!terminal || !config) {
    return (
      <span className="aq-agent-header-icon" role="img" aria-label={`${agentName ?? brand} agent`} title={agentName ?? brand}>
        <AgentIcon agent={brand} className="h-3.5 w-3.5" />
      </span>
    )
  }
  if (profile?.fetching && loadingArtUrl) {
    return (
      <span className="aq-agent-header-icon aq-agent-header-loading" role="status" aria-label={`Loading ${terminal.profileName} quota`} title="Loading quota">
        <img src={loadingArtUrl} alt="" aria-hidden="true" />
      </span>
    )
  }
  return (
    <span
      className="aq-agent-header-icon"
      role="status"
      aria-label={`${terminal.agent} quota profile ${terminal.profileName}`}
      title={`${terminal.profileName} quota profile`}
    >
      <AgentIcon agent={brand} icon={config.icon} className="h-3.5 w-3.5" />
    </span>
  )
}
