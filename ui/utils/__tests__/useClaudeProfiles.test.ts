import { describe, expect, it, vi } from 'vitest'

const listMock = vi.hoisted(() => vi.fn())
vi.mock('../../features/agent-quota/agentQuotaAPI', () => ({ listAgentProfiles: () => listMock() }))

import { currentClaudeProfiles, refreshClaudeProfiles } from '../useClaudeProfiles'

describe('the Claude profile list menus open with', () => {
  it('is the default alone until a scan answers, then the scanned profiles', async () => {
    expect(currentClaudeProfiles().map((c) => c.command)).toEqual(['claude'])
    listMock.mockResolvedValue([{ agent: 'claude', profileName: 'claude-work', profileDir: null, launcher: 'claude-work' }])
    await refreshClaudeProfiles()
    expect(currentClaudeProfiles().map((c) => c.command)).toEqual(['claude', 'claude-work'])
  })
})
