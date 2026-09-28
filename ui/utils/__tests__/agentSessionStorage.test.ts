/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearActiveForTab,
  clearStoredSessions,
  findInterruptedSessionByTabId,
  findSessionByTabId,
  loadStoredSessions,
  promoteStaleActiveSessions,
  removeStoredSession,
  upsertSession,
  type StoredAgentSession,
} from '../agentSessionStorage'

const VALID_UUID = '12345678-1234-1234-1234-123456789abc'
const OTHER_UUID = '87654321-4321-4321-4321-cba987654321'

function makeSession(overrides: Partial<StoredAgentSession> = {}): StoredAgentSession {
  return {
    id: `claude:${VALID_UUID}`,
    tabId: 'tab-1',
    agent: 'claude',
    launcher: 'claude-th',
    profileName: 'claude-th',
    sessionId: VALID_UUID,
    cwd: 'C:/repos/app',
    folderName: 'app',
    state: 'active',
    updatedAt: Date.now(),
    ...overrides,
  }
}

beforeEach(() => {
  clearStoredSessions()
  localStorage.clear()
})

describe('agentSessionStorage', () => {
  it('saves and loads a valid session', () => {
    upsertSession(makeSession())
    const list = loadStoredSessions()
    expect(list).toHaveLength(1)
    expect(list[0].sessionId).toBe(VALID_UUID)
    expect(list[0].launcher).toBe('claude-th')

    removeStoredSession(list[0].id)
    expect(loadStoredSessions()).toHaveLength(0)
  })

  it('rejects entries with an invalid session id or launcher shape', () => {
    localStorage.setItem('omniterm:agent-sessions', JSON.stringify([
      makeSession({ id: 'a', sessionId: 'not-a-uuid' }),
      makeSession({ id: 'b', launcher: 'PowerShell 7' }),
      // A pre-existing v1 record (command string, prompt summary) must not survive the strict schema.
      { id: 'legacy-1', paneIndex: 0, agentName: 'Claude Code', kind: 'unexpected', storedAt: Date.now(), resumeCommand: 'default --resume x' },
    ]))
    expect(loadStoredSessions()).toHaveLength(0)
  })

  it('drops entries older than the expiry window', () => {
    const stale = makeSession({ updatedAt: Date.now() - 15 * 24 * 60 * 60 * 1000 })
    localStorage.setItem('omniterm:agent-sessions', JSON.stringify([stale]))
    expect(loadStoredSessions()).toHaveLength(0)
  })

  it('caps stored sessions and keeps the most recent', () => {
    for (let i = 0; i < 25; i++) {
      const sessionId = `11111111-1111-1111-1111-${String(i).padStart(12, '1')}`
      upsertSession(makeSession({
        id: `claude:${sessionId}`,
        sessionId,
        tabId: `tab-${i}`,
        updatedAt: Date.now() + i,
      }))
    }
    expect(loadStoredSessions().length).toBeLessThanOrEqual(20)
  })

  it('dedupes by id, replacing rather than duplicating', () => {
    upsertSession(makeSession({ state: 'active' }))
    upsertSession(makeSession({ state: 'interrupted' }))
    const list = loadStoredSessions()
    expect(list).toHaveLength(1)
    expect(list[0].state).toBe('interrupted')
  })

  it('finds a session by tab id, ignoring saved bookmarks', () => {
    upsertSession(makeSession({ tabId: 'tab-1', state: 'active' }))
    upsertSession(makeSession({ id: `claude:${OTHER_UUID}`, sessionId: OTHER_UUID, tabId: 'tab-2', state: 'saved' }))

    expect(findSessionByTabId('tab-1')?.sessionId).toBe(VALID_UUID)
    expect(findSessionByTabId('tab-2')).toBeUndefined()
  })

  it('clears only an active entry for a tab id, leaving interrupted/saved sessions alone', () => {
    upsertSession(makeSession({ tabId: 'tab-1', state: 'active' }))
    clearActiveForTab('tab-1')
    expect(loadStoredSessions()).toHaveLength(0)

    upsertSession(makeSession({ tabId: 'tab-1', state: 'interrupted' }))
    clearActiveForTab('tab-1')
    expect(loadStoredSessions()).toHaveLength(1)
    expect(findInterruptedSessionByTabId('tab-1')?.sessionId).toBe(VALID_UUID)
  })

  it('promotes stale active sessions to interrupted on startup', () => {
    upsertSession(makeSession({ state: 'active' }))
    promoteStaleActiveSessions()
    expect(loadStoredSessions()[0].state).toBe('interrupted')
  })

  it('clears all sessions', () => {
    upsertSession(makeSession())
    expect(loadStoredSessions()).toHaveLength(1)
    clearStoredSessions()
    expect(loadStoredSessions()).toHaveLength(0)
  })
})
