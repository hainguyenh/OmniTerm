import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

import { getPanePresence, usePanePresence } from '../../utils/agentPresenceStore'
import { useStoredSessions } from '../../utils/agentSessionStorage'

import { useQuota } from './quotaStore'

/**
 * The status line an agent shows in its own terminal, for its pane's footer. The Claude status line
 * bridge keeps the text it printed per conversation, with how full the context window was (see
 * crates/app-core/src/agent_quota/statusline_store.rs); a pane finds its own by the profile folder
 * its agent runs from and the Claude conversation it tracks. Other agents have no per-conversation
 * record.
 */

/** How often a shown status line is read again; Claude Code renders it at most every 300 ms. */
export const STATUS_LINE_POLL_MS = 2_000
const MAX_TEXT = 2_000
/** Claude names its conversations by bare UUID; the backend rejects anything unsafe too. */
const CLAUDE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A conversation's last status line: its raw text and how full its context window was. */
export interface StatusLineRecord {
  text: string
  /** 0–100, or null when Claude Code did not say. */
  contextPct: number | null
}

/** Validate the IPC answer: a record with non-blank text, or no status line. */
export function parseStatusLine(value: unknown): StatusLineRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const { text, contextPct } = value as Record<string, unknown>
  if (typeof text !== 'string' || text.trim() === '') return null
  const pct = typeof contextPct === 'number' && Number.isFinite(contextPct) ? Math.min(100, Math.max(0, contextPct)) : null
  return { text: text.slice(0, MAX_TEXT), contextPct: pct }
}

/** The latest status line of one conversation, or null when there is none fresh (or on error). */
export function fetchStatusLine(profileDir: string, sessionId: string): Promise<StatusLineRecord | null> {
  return invoke<unknown>('agent_quota_statusline_text', { profileDir, sessionId }).then(
    parseStatusLine,
    () => null,
  )
}

/** What a pane footer shows of its agent's status line. */
export interface AgentStatusLine {
  /** The status line as one plain row; null when it printed nothing visible. */
  text: string | null
  contextPct: number | null
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

const sameLine = (a: AgentStatusLine | null, b: AgentStatusLine | null) =>
  a === b || (!!a && !!b && a.text === b.text && a.contextPct === b.contextPct)

/**
 * The status line of the agent in a pane, or null while it has none. Reads only while the pane
 * shows a Claude conversation of a known profile folder, and stops on unmount.
 */
export function useAgentStatusLine(paneId: string): AgentStatusLine | null {
  const profileDir = useQuota((state) => state.terminals[paneId]?.profileDir ?? null)
  const conversation = useClaudeConversation(paneId)
  const [line, setLine] = useState<{ key: string; value: AgentStatusLine | null } | null>(null)
  const key = profileDir && conversation ? `${profileDir}\n${conversation}` : null

  useEffect(() => {
    if (!profileDir || !conversation || !key) return
    let alive = true
    const read = () => {
      void fetchStatusLine(profileDir, conversation).then((raw) => {
        // The pane may have moved on to another conversation or agent meanwhile.
        if (!alive || getPanePresence(paneId)?.agent !== 'claude') return
        const value = raw === null ? null : { text: statusLineDisplay(raw.text) || null, contextPct: raw.contextPct }
        setLine((previous) => (previous?.key === key && sameLine(previous.value, value) ? previous : { key, value }))
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
  return line && line.key === key ? line.value : null
}
