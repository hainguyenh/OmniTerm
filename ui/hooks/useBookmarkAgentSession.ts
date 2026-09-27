/** Bookmark the Claude session running in one pane, so it shows up on the dashboard later. */
import { useEffect, useRef, useState } from 'react'
import { detectPaneAgents, resolveClaudeSessionId, type DetectedPaneAgent } from '../utils/agentSessionDetector'
import { upsertSession } from '../utils/agentSessionStorage'

export type BookmarkFeedback = 'idle' | 'pending' | 'done' | 'unavailable'

export function useBookmarkAgentSession(sessionId: string | null | undefined) {
  const [claudeAgent, setClaudeAgent] = useState<DetectedPaneAgent | null>(null)
  const [feedback, setFeedback] = useState<BookmarkFeedback>('idle')
  const feedbackTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setClaudeAgent(null)
      return
    }
    let cancelled = false
    void detectPaneAgents().then(list => {
      if (cancelled) return
      setClaudeAgent(list.find(entry => entry.sessionId === sessionId && entry.agent === 'claude') ?? null)
    })
    return () => { cancelled = true }
  }, [sessionId])

  useEffect(() => () => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current)
  }, [])

  const store = async (cwd: string | undefined, folderName: string | undefined) => {
    if (!sessionId || !claudeAgent || feedback === 'pending') return
    setFeedback('pending')
    const claudeSessionId = await resolveClaudeSessionId(claudeAgent, cwd)
    if (!claudeSessionId) {
      setFeedback('unavailable')
      feedbackTimerRef.current = window.setTimeout(() => setFeedback('idle'), 2000)
      return
    }
    upsertSession({
      id: `claude:${claudeSessionId}`,
      tabId: sessionId,
      agent: 'claude',
      launcher: claudeAgent.launcher,
      profileName: claudeAgent.profileName,
      sessionId: claudeSessionId,
      cwd,
      folderName,
      state: 'saved',
      updatedAt: Date.now(),
    })
    setFeedback('done')
    feedbackTimerRef.current = window.setTimeout(() => setFeedback('idle'), 2000)
  }

  return { canBookmark: Boolean(claudeAgent), feedback, store }
}
