import { describe, expect, it } from 'vitest'
import {
  AGENT_REGISTRY,
  formatAgentResumeCommand,
  getAgentResumeRecipe,
} from '../utils/agentRegistry'

describe('agentRegistry', () => {
  it('provides recipes for known agents', () => {
    expect(AGENT_REGISTRY['OpenCode']).toBeDefined()
    expect(AGENT_REGISTRY['OpenCode'].command).toBe('opencode')

    expect(AGENT_REGISTRY['Claude Code']).toBeDefined()
    expect(AGENT_REGISTRY['Claude Code'].command).toBe('claude')
    expect(AGENT_REGISTRY['Claude Code'].resumeArgs).toEqual(['--resume'])

    expect(AGENT_REGISTRY['Aider']).toBeDefined()
    expect(AGENT_REGISTRY['Aider'].command).toBe('aider')

    expect(AGENT_REGISTRY['Antigravity CLI']).toBeDefined()
    expect(AGENT_REGISTRY['Antigravity CLI'].command).toBe('agy')

    expect(AGENT_REGISTRY['Codex']).toBeDefined()
    expect(AGENT_REGISTRY['Codex'].command).toBe('codex')
  })

  it('matches agent recipes case-insensitively', () => {
    const opencode = getAgentResumeRecipe('opencode')
    expect(opencode?.command).toBe('opencode')

    const claude = getAgentResumeRecipe('claude code')
    expect(claude?.command).toBe('claude')

    const aider = getAgentResumeRecipe('AIDER')
    expect(aider?.command).toBe('aider')

    const agy = getAgentResumeRecipe('antigravity cli')
    expect(agy?.command).toBe('agy')

    const unknown = getAgentResumeRecipe('unknown-agent')
    expect(unknown).toBeNull()
  })

  it('resolves recipes for absent, empty, and command-alias lookups', () => {
    expect(getAgentResumeRecipe(null)).toBeNull()
    expect(getAgentResumeRecipe(undefined)).toBeNull()
    expect(getAgentResumeRecipe('   ')).toBeNull()
    // The CLI command name is as valid a key as the display name.
    expect(getAgentResumeRecipe('claude')?.command).toBe('claude')
    expect(getAgentResumeRecipe('  Goose  ')?.command).toBe('goose')
  })

  it('formats resume commands cleanly with arguments', () => {
    expect(formatAgentResumeCommand('OpenCode')).toBe('opencode')
    expect(formatAgentResumeCommand('Claude Code')).toBe('claude --resume')
    expect(formatAgentResumeCommand('Aider')).toBe('aider --restore-chat-history')
    expect(formatAgentResumeCommand('Antigravity CLI')).toBe('agy')
    expect(formatAgentResumeCommand('Codex')).toBe('codex resume')
    expect(formatAgentResumeCommand('Unknown')).toBeNull()
  })
})
