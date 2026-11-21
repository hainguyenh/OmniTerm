import { Bot, SquareTerminal } from 'lucide-react'
import type React from 'react'

import type { AgentKind } from './usage/types'

export type AgentBrand = AgentKind | 'opencode' | 'copilot'

type GlyphBrand = Exclude<AgentBrand, AgentKind>

/**
 * Claude, Codex and Antigravity draw their logo from the editor's icon set (`agent-<brand>`, the
 * SVGs under `ide/ui/omniterm/agents/`), so every surface shows the same mark. The other brands
 * have no logo there yet and keep a lucide glyph.
 */
const AGENT_GLYPHS: Record<GlyphBrand, React.ComponentType<{ className?: string }>> = {
  opencode: SquareTerminal,
  copilot: Bot,
}

const AGENT_ALIASES: Record<AgentBrand, readonly string[]> = {
  claude: ['claude', 'claude code'],
  codex: ['codex'],
  opencode: ['opencode', 'open code'],
  copilot: ['copilot', 'copilot cli'],
  agy: ['agy', 'antigravity', 'antigravity cli'],
}

export function agentBrandFromName(name?: string | null): AgentBrand | null {
  const normalized = name?.trim().toLowerCase()
  if (!normalized) return null
  return (Object.keys(AGENT_ALIASES) as AgentBrand[]).find((brand) =>
    AGENT_ALIASES[brand].some((alias) => normalized === alias || normalized.includes(alias))) ?? null
}

const isGlyphBrand = (brand: AgentBrand): brand is GlyphBrand => Object.hasOwn(AGENT_GLYPHS, brand)

/** The lucide glyph of a brand without a logo; null for the brands that draw their logo. */
export function glyphForAgent(agent: AgentBrand): React.ComponentType<{ className?: string }> | null {
  return isGlyphBrand(agent) ? AGENT_GLYPHS[agent] : null
}

/** The brands drawn from a lucide glyph, registered with the editor's icon set at start-up. */
export const GLYPH_BRANDS = Object.keys(AGENT_GLYPHS) as readonly GlyphBrand[]

/** The editor icon name of a brand: its logo, or its registered glyph (`ext:omniterm/agent-<brand>`). */
export function agentIconName(agent: AgentBrand): string {
  return isGlyphBrand(agent) ? `ext:omniterm/agent-${agent}` : `agent-${agent}`
}
