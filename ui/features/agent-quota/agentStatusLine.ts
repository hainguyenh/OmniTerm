import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

import { getPanePresence, usePanePresence } from '../../utils/agentPresenceStore'
import { useStoredSessions } from '../../utils/agentSessionStorage'

import { useQuota } from './quotaStore'

/**
 * The status line an agent shows in its own terminal, mirrored into its pane's footer. The Claude
 * status line bridge keeps the text it printed per conversation (see
 * crates/app-core/src/agent_quota/statusline_store.rs); a pane finds its own by the profile folder
 * its agent runs from and the Claude conversation it tracks. Other agents have no per-conversation
 * record, so their footers keep the quota.
 */

/** How often a shown status line is read again; Claude Code renders it at most every 300 ms. */
export const STATUS_LINE_POLL_MS = 5_000
const MAX_TEXT = 2_000
/** Claude names its conversations by bare UUID; the backend rejects anything unsafe too. */
const CLAUDE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validate the IPC answer: a non-blank string, or no status line. */
export function parseStatusLineText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.slice(0, MAX_TEXT) : null
}

/** The latest status line of one conversation, or null when there is none fresh (or on error). */
export function fetchStatusLine(profileDir: string, sessionId: string): Promise<string | null> {
  return invoke<unknown>('agent_quota_statusline_text', { profileDir, sessionId }).then(
    parseStatusLineText,
    () => null,
  )
}

/**
 * A status line as one row of plain text: terminal escapes (colours, OSC 8 links) and control
 * characters removed, its rows joined with ` · `, runs of spaces collapsed.
 */
export function statusLineDisplay(raw: string): string {
  return raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' · ')
}

/** The Claude conversation the pane runs, from what the pane already tracks. */
function useClaudeConversation(paneId: string): string | null {
  const presence = usePanePresence(paneId)
  const stored = useStoredSessions().find((item) => item.tabId === paneId && item.state !== 'saved')
  if (presence?.agent !== 'claude') return null
  const candidates = [presence.claudeSessionId, presence.agentSessionId, stored?.agent === 'claude' ? stored.sessionId : undefined]
  return candidates.find((id): id is string => typeof id === 'string' && CLAUDE_SESSION_ID.test(id)) ?? null
}

/**
 * The status line of the agent in a pane, as display text, or null while it has none. Reads only
 * while the pane shows a Claude conversation of a known profile folder, and stops on unmount.
 */
export function useAgentStatusLine(paneId: string): string | null {
  const profileDir = useQuota((state) => state.terminals[paneId]?.profileDir ?? null)
  const conversation = useClaudeConversation(paneId)
  const [line, setLine] = useState<{ key: string; text: string | null } | null>(null)
  const key = profileDir && conversation ? `${profileDir}\n${conversation}` : null

  useEffect(() => {
    if (!profileDir || !conversation || !key) return
    let alive = true
    const read = () => {
      void fetchStatusLine(profileDir, conversation).then((raw) => {
        // The pane may have moved on to another conversation or agent meanwhile.
        if (!alive || getPanePresence(paneId)?.agent !== 'claude') return
        const text = raw === null ? null : statusLineDisplay(raw) || null
        setLine((previous) => (previous?.key === key && previous.text === text ? previous : { key, text }))
      })
    }
    read()
    const timer = window.setInterval(read, STATUS_LINE_POLL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [paneId, profileDir, conversation, key])

  // A line read for an earlier conversation never shows for the current one.
  return line && line.key === key ? line.text : null
}
