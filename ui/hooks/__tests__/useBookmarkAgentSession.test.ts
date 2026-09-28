/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useBookmarkAgentSession } from '../useBookmarkAgentSession'
import {
  bindActiveSession,
  clearStoredSessions,
} from '../../utils/agentSessionStorage'
import { resetPanePresenceForTests, setPanePresence } from '../../utils/agentPresenceStore'

describe('useBookmarkAgentSession', () => {
  beforeEach(() => {
    clearStoredSessions()
    resetPanePresenceForTests()
  })

  it('returns canBookmark false when no agent is in the pane', () => {
    const { result } = renderHook(() => useBookmarkAgentSession('tab-empty'))
    expect(result.current.canBookmark).toBe(false)
    expect(result.current.state).toBe('none')
  })

  it('bookmarks and unbookmarks an active agy session matched by tabId', () => {
    setPanePresence({
      'tab-1': {
        agent: 'agy',
        profileName: 'gemini',
        pid: 1234,
        startTime: Date.now(),
        agentSessionId: 'latest',
      },
    })
    bindActiveSession({
      id: 'agy:agy-tab-1',
      tabId: 'tab-1',
      agent: 'agy',
      profileName: 'gemini',
      sessionId: 'latest',
      state: 'active',
      updatedAt: Date.now(),
    })

    const { result } = renderHook(() => useBookmarkAgentSession('tab-1'))
    expect(result.current.canBookmark).toBe(true)
    expect(result.current.state).toBe('none')

    act(() => {
      result.current.toggle()
    })
    expect(result.current.state).toBe('bookmarked')

    act(() => {
      result.current.toggle()
    })
    expect(result.current.state).toBe('none')
  })

  it('queues a pending bookmark when session is not yet stored', () => {
    setPanePresence({
      'tab-2': {
        agent: 'agy',
        profileName: 'gemini',
        pid: 5678,
        startTime: Date.now(),
        agentSessionId: 'latest',
      },
    })

    const { result } = renderHook(() => useBookmarkAgentSession('tab-2'))
    expect(result.current.canBookmark).toBe(true)
    expect(result.current.state).toBe('none')

    act(() => {
      result.current.toggle()
    })
    expect(result.current.state).toBe('pending')

    // Cancelling pending bookmark
    act(() => {
      result.current.toggle()
    })
    expect(result.current.state).toBe('none')
  })
})
