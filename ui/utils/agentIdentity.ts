/** Name and brand of an AI agent, shared by every surface that shows one (see AgentBadge). */
import { agentBrandFromName, type AgentBrand } from '../../plugins/agent-quota/app/agentBrand'

const AGENT_LABELS: Record<AgentBrand, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  copilot: 'Copilot CLI',
  agy: 'Antigravity CLI',
  gemini: 'Gemini CLI',
}

function isBrand(value: string): value is AgentBrand {
  return Object.prototype.hasOwnProperty.call(AGENT_LABELS, value)
}

/** The brand for a detected agent kind (`claude`) or a display name parsed from a title. */
export function agentBrandFor(agent?: string | null): AgentBrand | null {
  if (!agent) return null
  return isBrand(agent) ? agent : agentBrandFromName(agent)
}

/** "Claude Code · profile claude-work" — the tooltip text that stands in for a visible name. */
export function agentTooltip(brand: AgentBrand, profileName?: string): string {
  const label = AGENT_LABELS[brand]
  return profileName && profileName.toLowerCase() !== brand ? `${label} · profile ${profileName}` : label
}
