/**
 * Large text paste handling for AI agent panes.
 *
 * Pasting large blobs of text into a terminal prompt can overwhelm PTY buffers,
 * garble escape sequences, and pollute the prompt history. In AI agent panes
 * (Claude Code, Antigravity CLI, OpenCode, Codex, Aider), large pastes can be
 * saved as attachment documents and referenced by path instead, allowing the agent
 * to inspect full context with native file tools.
 *
 * Thresholds:
 * - < 1,000 chars: Paste directly (no prompt).
 * - 1,000 - 3,000 chars: Prompt user (Attach as document vs Paste directly).
 * - > 3,000 chars: Force/attach as document directly.
 */
import type { Terminal } from '@xterm/xterm'

import { formatAttachmentPaths, type SavedAttachment } from './attachmentInput'
import { requestLargeTextPasteDecision } from './largeTextPasteStore'

export const LARGE_TEXT_PROMPT_THRESHOLD = 1000
export const LARGE_TEXT_FORCE_THRESHOLD = 3000

export const countLines = (text: string): number => {
  if (!text) return 0
  return (text.match(/\r\n|\r|\n/g)?.length ?? 0) + 1
}

export const createTextPreview = (text: string, maxLength = 260): string => {
  const trimmed = text.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength)}…`
}

/**
 * Infer the best file extension based on text content.
 * Markdown and JSON are structured formats that agents can parse immediately.
 */
export const detectTextAttachmentName = (text: string): string => {
  const trimmed = text.trim()
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed)
      return 'pasted-data.json'
    } catch {
      // Not valid JSON
    }
  }
  if (/(?:^|\n)(?:#{1,6}\s|```|[-*]\s\[[ x]\])/m.test(trimmed)) {
    return 'pasted-document.md'
  }
  return 'pasted-text.txt'
}

/**
 * Save text content as an attachment file via the backend attachment manager.
 */
export const saveTextAsAttachment = async (text: string): Promise<SavedAttachment | null> => {
  const nameHint = detectTextAttachmentName(text)
  const bytes = new TextEncoder().encode(text)
  try {
    const info = await window.omnitermAPI.attachments?.save(nameHint, bytes)
    return info ? { info } : null
  } catch {
    return null
  }
}

export interface HandleLargeTextPasteOptions {
  text: string
  term: Terminal
  sessionId?: string
  noteLocalEcho: () => void
  onFilesSaved?: (saved: SavedAttachment[]) => void
  promptDecision?: (
    sessionId: string,
    text: string,
    charCount: number,
    lineCount: number,
    preview: string,
  ) => Promise<'attach' | 'paste' | 'cancel'>
}

/**
 * Handle a paste of text when the pane is in an agent mode that supports path insertion.
 * Returns true if paste was handled (attached or pasted), false if cancelled.
 */
export const handleLargeTextPaste = async ({
  text,
  term,
  sessionId,
  noteLocalEcho,
  onFilesSaved,
  promptDecision = requestLargeTextPasteDecision,
}: HandleLargeTextPasteOptions): Promise<boolean> => {
  if (text.length < LARGE_TEXT_PROMPT_THRESHOLD) {
    noteLocalEcho()
    term.paste(text)
    return true
  }

  const attachDirectly = async (): Promise<boolean> => {
    const saved = await saveTextAsAttachment(text)
    if (saved) {
      onFilesSaved?.([saved])
      noteLocalEcho()
      term.paste(formatAttachmentPaths([saved.info.path]))
      return true
    }
    // Fall back to direct paste if saving failed
    noteLocalEcho()
    term.paste(text)
    return true
  }

  if (text.length > LARGE_TEXT_FORCE_THRESHOLD) {
    return attachDirectly()
  }

  // Between 1,000 and 3,000 characters: prompt the user
  const charCount = text.length
  const lineCount = countLines(text)
  const preview = createTextPreview(text)
  const effectiveSessionId = sessionId ?? 'active'
  const decision = await promptDecision(effectiveSessionId, text, charCount, lineCount, preview)

  if (decision === 'attach') {
    return attachDirectly()
  }
  if (decision === 'paste') {
    noteLocalEcho()
    term.paste(text)
    return true
  }
  return false
}
