import { AlarmClock } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { agentBrandFromName, iconForAgent, type AgentBrand } from '../agentBrand'

const BRANDS: AgentBrand[] = ['claude', 'codex', 'opencode', 'copilot', 'agy', 'gemini']

describe('agent brand icons', () => {
  it('gives every agent its own icon, distinct from the strip\'s wake-up clock', () => {
    const icons = BRANDS.map(iconForAgent)
    expect(new Set(icons).size).toBe(BRANDS.length)
    // The quota strip draws AlarmClock as its wake-up button; an agent using it reads as a control.
    expect(icons).not.toContain(AlarmClock)
  })

  it('maps display names to brands', () => {
    expect(agentBrandFromName('Claude Code')).toBe('claude')
    expect(agentBrandFromName('Antigravity CLI')).toBe('agy')
    expect(agentBrandFromName('bash')).toBeNull()
  })
})
