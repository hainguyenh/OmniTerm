/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { agentBookmark } from '../agentBookmark'
import { bindActiveSession, clearStoredSessions, loadStoredSessions, upsertSession } from '../agentSessionStorage'
import { resetPanePresenceForTests, setPanePresence } from '../agentPresenceStore'

const presence = (pid: number) => ({ agent: 'agy' as const, profileName: 'gemini', pid, startTime: Date.now(), agentSessionId: 'latest' })

describe('agentBookmark', () => {
  beforeEach(() => {
    clearStoredSessions()
    resetPanePresenceForTests()
  })

  it('offers nothing when no agent runs in the pane', () => {
    expect(agentBookmark('tab-empty')).toBeNull()
  })

  it('bookmarks and unbookmarks an active session matched by its tab', () => {
    setPanePresence({ 'tab-1': presence(1234) })
    bindActiveSession({
      id: 'agy:agy-tab-1',
      tabId: 'tab-1',
      agent: 'agy',
      profileName: 'gemini',
      sessionId: 'latest',
      state: 'active',
      updatedAt: Date.now(),
    })

    expect(agentBookmark('tab-1')?.state).toBe('none')
    agentBookmark('tab-1')?.toggle()
    expect(agentBookmark('tab-1')?.state).toBe('bookmarked')
    agentBookmark('tab-1')?.toggle()
    expect(agentBookmark('tab-1')?.state).toBe('none')
  })

  it('queues a pending bookmark while the session is not stored yet, and cancels it', () => {
    setPanePresence({ 'tab-2': presence(5678) })

    agentBookmark('tab-2')?.toggle()
    expect(agentBookmark('tab-2')?.state).toBe('pending')
    agentBookmark('tab-2')?.toggle()
    expect(agentBookmark('tab-2')?.state).toBe('none')
  })

  it('bookmarks the running session, not an interrupted one of an earlier run with the same tab id', () => {
    const oldId = '11111111-1111-4111-8111-111111111111'
    const liveId = '22222222-2222-4222-8222-222222222222'
    upsertSession({ id: `claude:${oldId}`, tabId: 'tab-3', agent: 'claude', profileName: 'claude', sessionId: oldId, state: 'interrupted', updatedAt: Date.now() })
    bindActiveSession({ id: `claude:${liveId}`, tabId: 'tab-3', agent: 'claude', profileName: 'claude', sessionId: liveId, state: 'active', updatedAt: Date.now() })
    setPanePresence({ 'tab-3': { agent: 'claude', profileName: 'claude', pid: 1, startTime: 1, agentSessionId: liveId, claudeSessionId: liveId } })

    agentBookmark('tab-3')?.toggle()

    const byId = new Map(loadStoredSessions().map(item => [item.sessionId, item]))
    expect(byId.get(liveId)?.bookmarked).toBe(true)
    expect(byId.get(oldId)?.bookmarked).toBeUndefined()
    expect(agentBookmark('tab-3')?.state).toBe('bookmarked')
  })

  it('applies a queued bookmark once the poll binds the session', () => {
    setPanePresence({ 'tab-4': presence(42) })
    agentBookmark('tab-4')?.toggle()

    bindActiveSession({ id: 'agy:agy-tab-4', tabId: 'tab-4', agent: 'agy', profileName: 'gemini', sessionId: 'latest', state: 'active', updatedAt: Date.now() })

    expect(agentBookmark('tab-4')?.state).toBe('bookmarked')
  })
})
