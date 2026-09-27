import { describe, expect, it } from 'vitest'
import {
  AGENT_REGISTRY,
  formatAgentProfileCommand,
  formatAgentResumeCommand,
  getAgentResumeRecipe,
  imagePasteModeFor,
  latchAgent,
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

    expect(AGENT_REGISTRY['Antigravity CLI']?.command).toBe('agy')

    expect(AGENT_REGISTRY['Codex']).toBeDefined()
    expect(AGENT_REGISTRY['Codex']?.command).toBe('codex')

    expect(AGENT_REGISTRY['Copilot CLI']?.command).toBe('copilot')
  })

  it('matches agent recipes case-insensitively', () => {
    const opencode = getAgentResumeRecipe('opencode')
    expect(opencode?.command).toBe('opencode')

    const claude = getAgentResumeRecipe('claude code')
    expect(claude?.command).toBe('claude')

    const aider = getAgentResumeRecipe('AIDER')
    expect(aider?.command).toBe('aider')

    expect(getAgentResumeRecipe('antigravity cli')?.command).toBe('agy')

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
    expect(formatAgentResumeCommand('Antigravity CLI')).toBe('agy resume')
    expect(formatAgentResumeCommand('Codex')).toBe('codex resume --last')
    expect(formatAgentResumeCommand('Gemini CLI')).toBe('gemini --resume')
    expect(formatAgentResumeCommand('Copilot CLI')).toBe('copilot --continue')
    expect(formatAgentResumeCommand('Unknown')).toBeNull()
  })

  const VALID_UUID = '11111111-1111-1111-1111-111111111111'

  it('only builds a resume command for a strictly-shaped session id', () => {
    // A non-UUID session id (the old, unvalidated shape) must never reach a shell string.
    expect(formatAgentResumeCommand('Claude Code', '111-222', 'claude-th')).toBeNull()
    expect(formatAgentResumeCommand('Codex', '111-222')).toBeNull()
    expect(formatAgentResumeCommand('Antigravity CLI', '111-222')).toBeNull()

    expect(formatAgentResumeCommand('Claude Code', VALID_UUID, 'claude-th')).toBe(`claude-th --resume ${VALID_UUID}`)
    expect(formatAgentResumeCommand('Codex', VALID_UUID)).toBe(`codex resume ${VALID_UUID}`)
    expect(formatAgentResumeCommand('Antigravity CLI', VALID_UUID)).toBe(`agy resume ${VALID_UUID}`)
    expect(formatAgentResumeCommand('Claude Code', VALID_UUID)).toBe(`claude --resume ${VALID_UUID}`)
    expect(formatAgentResumeCommand('Claude Code', VALID_UUID, undefined, 'work')).toBe(`claude-work --resume ${VALID_UUID}`)
    expect(formatAgentResumeCommand('Claude Code', VALID_UUID, undefined, 'claude-th')).toBe(`claude-th --resume ${VALID_UUID}`)
    expect(formatAgentResumeCommand('Claude Code', VALID_UUID, undefined, 'claude')).toBe(`claude --resume ${VALID_UUID}`)
  })

  it('formats agent profile commands to reopen sessions with the correct profile', () => {
    expect(formatAgentProfileCommand('Claude Code', 'claude-th')).toBe('claude-th')
    expect(formatAgentProfileCommand('Claude Code', undefined, 'work')).toBe('claude-work')
    expect(formatAgentProfileCommand('Claude Code', undefined, 'claude-th')).toBe('claude-th')
    expect(formatAgentProfileCommand('Claude Code', undefined, 'claude')).toBe('claude')
    expect(formatAgentProfileCommand('Claude Code')).toBe('claude')
    expect(formatAgentProfileCommand('Codex', undefined, 'team')).toBe('codex-team')
  })

  it('rejects a launcher that is not shaped like a real profile launcher', () => {
    // A shell label or other free-form string must never become the executed command name.
    expect(formatAgentResumeCommand('Claude Code', VALID_UUID, 'PowerShell 7')).toBeNull()
    expect(formatAgentResumeCommand('Claude Code', VALID_UUID, 'default')).toBeNull()
    expect(formatAgentResumeCommand('Claude Code', VALID_UUID, '../../evil')).toBeNull()
  })

  it('inserts pasted-image paths for agents verified to attach by path', () => {
    expect(imagePasteModeFor('OpenCode')).toBe('insert-path')
    expect(imagePasteModeFor('Claude Code')).toBe('insert-path')
    expect(imagePasteModeFor('Gemini CLI')).toBe('insert-path')
    expect(imagePasteModeFor('Antigravity CLI')).toBe('insert-path')
    expect(imagePasteModeFor('agy')).toBe('insert-path')
    expect(imagePasteModeFor('Codex')).toBe('insert-path')
    expect(imagePasteModeFor('Aider')).toBe('insert-path')
  })

  it('forwards image paste for unknown agents and plain panes', () => {
    expect(imagePasteModeFor(null)).toBe('forward')
    expect(imagePasteModeFor(undefined)).toBe('forward')
    expect(imagePasteModeFor('')).toBe('forward')
    expect(imagePasteModeFor('   ')).toBe('forward')
    expect(imagePasteModeFor('unknown-agent')).toBe('forward')
    expect(imagePasteModeFor('opencode')).toBe('insert-path')
  })

  it('latches agent detection so a bare-cwd title rewrite cannot demote it', () => {
    // The OpenCode regression: the agent is detected at launch, then its TUI rewrites the title
    // to a plain path, detection went null, and image paste silently turned to 'forward'.
    expect(latchAgent(null, 'OpenCode')).toBe('OpenCode')
    expect(latchAgent('OpenCode', null)).toBe('OpenCode')
    expect(latchAgent('OpenCode', 'Claude Code')).toBe('Claude Code') // a known agent takes over
    expect(latchAgent(null, null)).toBeNull()
  })
})
