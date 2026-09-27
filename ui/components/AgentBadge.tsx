import { AgentIcon } from '../../plugins/agent-quota/app/QuotaLine'
import { useQuota } from '../../plugins/agent-quota/app/quotaStore'
import { agentBrandFor, agentTooltip } from '../utils/agentIdentity'
import { Tooltip, type TooltipPlacement } from './Tooltip'

/**
 * The one visual for "an AI agent runs here", used by the pane header, tabs, footer, dashboard,
 * overlays and the Bookmarks view alike. The icon alone carries the identity; the agent's name
 * and profile live in the tooltip, so no surface spells out "Claude Code" next to it.
 */
export function AgentBadge({
  agent,
  profileName,
  className = 'w-3 h-3',
  placement = 'bottom',
}: {
  /** A detected agent kind (`claude`) or a display name (`Claude Code`). */
  agent: string
  profileName?: string
  className?: string
  placement?: TooltipPlacement
}) {
  const brand = agentBrandFor(agent)
  // The user's chosen emoji (Agent Quota settings) applies everywhere, not only in the quota strip.
  const icon = useQuota(state => brand && (brand === 'claude' || brand === 'codex') ? state.config.agents[brand]?.icon : undefined)
  if (!brand) return null
  const tooltip = agentTooltip(brand, profileName)
  return (
    <Tooltip content={tooltip} placement={placement}>
      <span
        className="inline-flex flex-shrink-0 items-center justify-center text-theme-accent"
        role="img"
        aria-label={tooltip}
        data-agent-badge={brand}
      >
        <AgentIcon agent={brand} icon={icon} className={className} />
      </span>
    </Tooltip>
  )
}
