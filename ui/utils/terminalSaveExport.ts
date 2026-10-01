/**
 * The pane footer's "Save output": the whole conversation for an agent pane, the terminal buffer
 * otherwise.
 *
 * xterm keeps a bounded scrollback, and agent TUIs clear and redraw it (Codex even runs on the
 * alternate screen), so saving the buffer kept only the tail of a long session. For a Claude pane
 * the complete conversation is read from Claude's own session file instead — located by the
 * profile directory `agent_quota_detect` reports for the pane's process and a validated session
 * id, never by a path from here. Anything that cannot be resolved falls back to the buffer.
 */

import { detectPaneAgents, resolveClaudeSessionId } from './agentSessionDetector'
import { getPanePresence } from './agentPresenceStore'
import { findSessionByTabId } from './agentSessionStorage'
import { bufferText, TERMINAL_SAVE_OUTPUT_EVENT, type TerminalBufferLike } from './terminalCopyExtract'

export interface SaveExport {
  suggestedName: string
  content: string
}

const BUFFER_FILE_NAME = 'terminal-output.txt'
/** Claude names its session files by bare UUID; the backend rejects anything else too. */
const CLAUDE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The Claude session this pane resumes or runs, from what the pane already tracks. */
function claudeSessionIdFor(sessionId: string): string | null {
  const presence = getPanePresence(sessionId)
  const stored = findSessionByTabId(sessionId)
  const candidates = [presence?.claudeSessionId, presence?.agentSessionId, stored?.agent === 'claude' ? stored.sessionId : undefined]
  return candidates.find((candidate): candidate is string => typeof candidate === 'string' && CLAUDE_SESSION_ID.test(candidate)) ?? null
}

/** The pane's whole Claude conversation, or null when it is not a Claude pane with a session file. */
export async function claudeTranscriptExport(sessionId: string): Promise<SaveExport | null> {
  const exportTranscript = window.omnitermAPI?.agentSessions?.exportClaudeTranscript
  if (!exportTranscript) return null
  const agent = (await detectPaneAgents()).find(entry => entry.sessionId === sessionId)
  if (agent?.agent !== 'claude' || !agent.profileDir) return null
  // Not tracked yet (a fresh launch): look the file up the way pane tracking does.
  const claudeSessionId = claudeSessionIdFor(sessionId) ?? await resolveClaudeSessionId(agent, findSessionByTabId(sessionId)?.cwd)
  if (!claudeSessionId || !CLAUDE_SESSION_ID.test(claudeSessionId)) return null
  const content = await exportTranscript(agent.profileDir, claudeSessionId).catch(() => null)
  if (typeof content !== 'string' || content.trim() === '') return null
  return { suggestedName: `claude-conversation-${claudeSessionId.slice(0, 8)}.txt`, content }
}

/** What Save writes for this pane: the agent conversation when there is one, else the buffer. */
export async function resolveSaveExport(sessionId: string, buffer: TerminalBufferLike): Promise<SaveExport | null> {
  const transcript = await claudeTranscriptExport(sessionId)
  if (transcript) return transcript
  const content = bufferText(buffer)
  return content ? { suggestedName: BUFFER_FILE_NAME, content } : null
}

/**
 * Answer this pane's save requests at the xterm owner, keeping buffer access out of the toolbar.
 * Requests for other sessions or from a replaced pane are ignored; an empty export opens no dialog.
 */
export const registerTerminalSaveExport = (options: {
  sessionId: string
  /** False once the pane's xterm was recreated, so a stale listener never answers. */
  isCurrent: () => boolean
  buffer: TerminalBufferLike
}): (() => void) => {
  const { sessionId, isCurrent, buffer } = options
  const onSaveRequest = (event: Event) => {
    if (!(event instanceof CustomEvent)) return
    const detail = event.detail as { sessionId?: unknown } | undefined
    if (detail?.sessionId !== sessionId || !isCurrent()) return
    void resolveSaveExport(sessionId, buffer).then((saved) => {
      if (saved) void window.omnitermAPI.files.exportText(saved)
    })
  }
  window.addEventListener(TERMINAL_SAVE_OUTPUT_EVENT, onSaveRequest)
  return () => window.removeEventListener(TERMINAL_SAVE_OUTPUT_EVENT, onSaveRequest)
}
