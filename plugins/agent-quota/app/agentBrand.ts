import { Bot, CodeXml, Gem, Orbit, Sparkles, SquareTerminal } from 'lucide-react'
import type React from 'react'

import type { AgentKind } from '../src/types'

export type AgentBrand = AgentKind | 'opencode' | 'copilot' | 'agy' | 'gemini'

const AGENT_ICONS: Record<AgentBrand, React.ComponentType<{ className?: string }>> = {
  claude: Sparkles,
  codex: CodeXml,
  opencode: SquareTerminal,
  copilot: Bot,
  agy: Orbit,
  gemini: Gem,
}

const AGENT_ALIASES: Record<AgentBrand, readonly string[]> = {
  claude: ['claude', 'claude code'],
  codex: ['codex'],
  opencode: ['opencode', 'open code'],
  copilot: ['copilot', 'copilot cli'],
  agy: ['agy', 'antigravity', 'antigravity cli'],
  gemini: ['gemini', 'gemini cli'],
}

export function agentBrandFromName(name?: string | null): AgentBrand | null {
  const normalized = name?.trim().toLowerCase()
  if (!normalized) return null
  return (Object.keys(AGENT_ALIASES) as AgentBrand[]).find((brand) =>
    AGENT_ALIASES[brand].some((alias) => normalized === alias || normalized.includes(alias))) ?? null
}

export function iconForAgent(agent: AgentBrand): React.ComponentType<{ className?: string }> {
  return AGENT_ICONS[agent]
}
