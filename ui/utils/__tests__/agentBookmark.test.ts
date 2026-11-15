/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { agentBookmark } from '../agentBookmark'
import { bindActiveSession, clearStoredSessions } from '../agentSessionStorage'
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
})
