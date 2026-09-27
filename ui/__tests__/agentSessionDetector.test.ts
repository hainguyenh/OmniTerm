import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  detectPaneAgents,
  isValidLauncher,
  isValidSessionId,
  resolveClaudeSessionId,
  type DetectedPaneAgent,
} from '../utils/agentSessionDetector'

const VALID_UUID = '57831da0-bfa1-4d51-b04b-d589392813c4'

function agent(overrides: Partial<DetectedPaneAgent> = {}): DetectedPaneAgent {
  return {
    sessionId: 'tab-1',
    agent: 'claude',
    pid: 100,
    startTime: 1_700_000_000,
    profileDir: 'C:/Users/me/claude-profiles/claude-th',
    profileName: 'claude-th',
    launcher: 'claude-th',
    subAgentCount: 0,
    ...overrides,
  }
}

describe('agentSessionDetector', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('validates session ids strictly', () => {
    expect(isValidSessionId(VALID_UUID)).toBe(true)
    expect(isValidSessionId('111-222')).toBe(false)
    expect(isValidSessionId('x & calc & aaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false)
    expect(isValidSessionId(undefined)).toBe(false)
  })

  it('validates launcher names against the agent-quota launcher rule', () => {
    expect(isValidLauncher('claude-th')).toBe(true)
    expect(isValidLauncher('codex-work')).toBe(true)
    expect(isValidLauncher('PowerShell 7')).toBe(false)
    expect(isValidLauncher('default')).toBe(false)
    expect(isValidLauncher('../../evil')).toBe(false)
  })

  it('detectPaneAgents forwards the batched detection call', async () => {
    const detect = vi.fn().mockResolvedValue([agent()])
    vi.stubGlobal('window', { omnitermAPI: { agentSessions: { detect } } })

    const result = await detectPaneAgents()
    expect(detect).toHaveBeenCalledTimes(1)
    expect(result).toEqual([agent()])
  })

  it('detectPaneAgents fails safe to an empty list', async () => {
    vi.stubGlobal('window', { omnitermAPI: { agentSessions: { detect: vi.fn().mockRejectedValue(new Error('nope')) } } })
    expect(await detectPaneAgents()).toEqual([])

    vi.stubGlobal('window', { omnitermAPI: undefined })
    expect(await detectPaneAgents()).toEqual([])
  })

  it('resolveClaudeSessionId only resolves for a Claude agent with a profile dir and cwd', async () => {
    const resolveClaudeSession = vi.fn().mockResolvedValue(VALID_UUID)
    vi.stubGlobal('window', { omnitermAPI: { agentSessions: { resolveClaudeSession } } })

    expect(await resolveClaudeSessionId(agent(), 'D:/work/proj')).toBe(VALID_UUID)
    expect(resolveClaudeSession).toHaveBeenCalledWith('C:/Users/me/claude-profiles/claude-th', 'D:/work/proj', 1_700_000_000)

    expect(await resolveClaudeSessionId(agent({ agent: 'codex' }), 'D:/work/proj')).toBeNull()
    expect(await resolveClaudeSessionId(agent({ profileDir: undefined }), 'D:/work/proj')).toBeNull()
    expect(await resolveClaudeSessionId(agent(), undefined)).toBeNull()
  })

  it('resolveClaudeSessionId rejects a result that is not a strict UUID', async () => {
    const resolveClaudeSession = vi.fn().mockResolvedValue('not-a-uuid')
    vi.stubGlobal('window', { omnitermAPI: { agentSessions: { resolveClaudeSession } } })
    expect(await resolveClaudeSessionId(agent(), 'D:/work/proj')).toBeNull()
  })
})
