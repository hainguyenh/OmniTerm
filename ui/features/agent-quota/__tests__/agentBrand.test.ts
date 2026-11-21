import { describe, expect, it } from 'vitest'

import { agentBrandFromName, agentIconName, glyphForAgent, GLYPH_BRANDS, type AgentBrand } from '../agentBrand'

const BRANDS: AgentBrand[] = ['claude', 'codex', 'opencode', 'copilot', 'agy']

describe('agent brand icons', () => {
  it('gives every agent its own icon name', () => {
    const names = BRANDS.map(agentIconName)
    expect(new Set(names).size).toBe(BRANDS.length)
  })

  it('draws Claude, Codex and Antigravity from the editor logo set, the same mark everywhere', () => {
    expect((['claude', 'codex', 'agy'] as const).map(agentIconName))
      .toEqual(['agent-claude', 'agent-codex', 'agent-agy'])
    expect(glyphForAgent('claude')).toBeNull()
    expect(glyphForAgent('agy')).toBeNull()
  })

  it('keeps a registered glyph for the brands without a logo', () => {
    expect([...GLYPH_BRANDS].sort()).toEqual(['copilot', 'opencode'])
    expect(agentIconName('opencode')).toBe('ext:omniterm/agent-opencode')
    expect(glyphForAgent('copilot')).not.toBeNull()
  })

  it('maps display names to brands and no longer knows Gemini CLI', () => {
    expect(agentBrandFromName('Claude Code')).toBe('claude')
    expect(agentBrandFromName('Antigravity CLI')).toBe('agy')
    expect(agentBrandFromName('Gemini CLI')).toBeNull()
    expect(agentBrandFromName('bash')).toBeNull()
  })
})
