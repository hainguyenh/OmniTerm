import { afterEach, describe, expect, it } from 'vitest'

import { agentRelaunchCommand } from '../agentRelaunch'
import { resetPanePresenceForTests, setPanePresence } from '../agentPresenceStore'
import { clearStoredSessions, upsertSession } from '../agentSessionStorage'

describe('agentRelaunchCommand', () => {
  afterEach(() => {
    clearStoredSessions()
    resetPanePresenceForTests()
  })

  it('is null for a pane that runs no known agent', () => {
    expect(agentRelaunchCommand('t1')).toBeNull()
  })

  it('starts the profile the live agent runs when it saved no session', () => {
    setPanePresence({ t1: { agent: 'claude', profileName: 'claude-work', launcher: 'claude-work', pid: 1, startTime: 1 } })
    expect(agentRelaunchCommand('t1')).toBe('claude-work')
  })

  it('prefers the profile of the stored session', () => {
    setPanePresence({ t1: { agent: 'claude', profileName: 'claude', pid: 1, startTime: 1 } })
    upsertSession({ id: 'claude:11111111-1111-4111-8111-111111111111', agent: 'claude', profileName: 'claude-work', launcher: 'claude-work', sessionId: '11111111-1111-4111-8111-111111111111', tabId: 't1', state: 'active', updatedAt: Date.now() })
    expect(agentRelaunchCommand('t1')).toBe('claude-work')
  })
})
