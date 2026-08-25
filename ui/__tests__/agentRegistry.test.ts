import { describe, expect, it } from 'vitest'
import {
  AGENT_REGISTRY,
  formatAgentResumeCommand,
  getAgentResumeRecipe,
  imagePasteModeFor,
} from '../utils/agentRegistry'

describe('agentRegistry', () => {
  it('provides recipes for known agents', () => {
    expect(AGENT_REGISTRY['OpenCode']).toBeDefined()
    expect(AGENT_REGISTRY['OpenCode']?.command).toBe('opencode')

    expect(AGENT_REGISTRY['Claude Code']).toBeDefined()
    expect(AGENT_REGISTRY['Claude Code']?.command).toBe('claude')
    expect(AGENT_REGISTRY['Claude Code']?.resumeArgs).toEqual(['--continue'])

    expect(AGENT_REGISTRY['Aider']).toBeDefined()
    expect(AGENT_REGISTRY['Aider']?.command).toBe('aider')

    expect(AGENT_REGISTRY['Antigravity CLI']).toBeNull()

    expect(AGENT_REGISTRY['Codex']).toBeDefined()
    expect(AGENT_REGISTRY['Codex']?.command).toBe('codex')
  })

  it('matches agent recipes case-insensitively', () => {
    const opencode = getAgentResumeRecipe('opencode')
    expect(opencode?.command).toBe('opencode')

    const claude = getAgentResumeRecipe('claude code')
    expect(claude?.command).toBe('claude')

    const aider = getAgentResumeRecipe('AIDER')
    expect(aider?.command).toBe('aider')

    expect(getAgentResumeRecipe('antigravity cli')).toBeNull()

    const unknown = getAgentResumeRecipe('unknown-agent')
    expect(unknown).toBeNull()
  })

  it('resolves recipes for absent, empty, and command-alias lookups', () => {
    expect(getAgentResumeRecipe(null)).toBeNull()
    expect(getAgentResumeRecipe(undefined)).toBeNull()
    expect(getAgentResumeRecipe('   ')).toBeNull()
    // The CLI command name is as valid a key as the display name.
    expect(getAgentResumeRecipe('claude')?.command).toBe('claude')
    expect(getAgentResumeRecipe('  Goose  ')).toBeNull()
  })

  it('formats resume commands cleanly with arguments', () => {
    expect(formatAgentResumeCommand('OpenCode')).toBe('opencode --continue')
    expect(formatAgentResumeCommand('Claude Code')).toBe('claude --continue')
    expect(formatAgentResumeCommand('Aider')).toBe('aider --restore-chat-history')
    expect(formatAgentResumeCommand('Antigravity CLI')).toBeNull()
    expect(formatAgentResumeCommand('Codex')).toBe('codex resume --last')
    expect(formatAgentResumeCommand('Gemini CLI')).toBe('gemini --resume')
    expect(formatAgentResumeCommand('Copilot CLI')).toBeNull()
    expect(formatAgentResumeCommand('Unknown')).toBeNull()
  })

  it('inserts pasted-image paths only for agents verified to attach by path', () => {
    expect(imagePasteModeFor('OpenCode')).toBe('insert-path')
    expect(imagePasteModeFor('Claude Code')).toBe('insert-path')
    expect(imagePasteModeFor('Gemini CLI')).toBe('insert-path')

    // Antigravity CLI binds Alt+V to its own clipboard reader; a path in the prompt is noise.
    expect(imagePasteModeFor('Antigravity CLI')).toBe('forward')
  })

  it('forwards image paste for unknown agents and plain panes', () => {
    expect(imagePasteModeFor(null)).toBe('forward')
    expect(imagePasteModeFor(undefined)).toBe('forward')
    expect(imagePasteModeFor('')).toBe('forward')
    expect(imagePasteModeFor('   ')).toBe('forward')
    expect(imagePasteModeFor('unknown-agent')).toBe('forward')
    expect(imagePasteModeFor('opencode')).toBe('insert-path')
  })
})
