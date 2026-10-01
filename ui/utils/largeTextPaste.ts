/**
 * Large text paste handling for AI agent panes.
 *
 * Pasting large blobs of text into a terminal prompt can overwhelm PTY buffers,
 * garble escape sequences, and pollute the prompt history. In AI agent panes
 * (Claude Code, Antigravity CLI, OpenCode, Codex, Aider), large pastes can be
 * saved as attachment documents and referenced by path instead, allowing the agent
 * to inspect full context with native file tools.
 *
 * Thresholds (Settings → General → Attachments; defaults shown):
 * - below 1,000 chars: Paste directly (no prompt).
 * - 1,000 - 3,000 chars: Prompt user (Attach as document vs Paste directly).
 * - above 3,000 chars: Attach as document directly.
 */
import type { Terminal } from '@xterm/xterm'

import { formatAttachmentPaths, type SavedAttachment } from './attachmentInput'
import { requestLargeTextPasteDecision } from './largeTextPasteStore'

export const LARGE_TEXT_PROMPT_THRESHOLD = 1000
export const LARGE_TEXT_FORCE_THRESHOLD = 3000
/** The range the settings accept for either threshold. */
export const LARGE_PASTE_MIN_CHARS = 100
export const LARGE_PASTE_MAX_CHARS = 1_000_000

export interface LargePasteThresholds {
  /** From this many characters, ask whether to attach the paste as a document. */
  promptChars: number
  /** Above this many characters, attach it without asking. Never below `promptChars`. */
  attachChars: number
}

const clampChars = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(LARGE_PASTE_MAX_CHARS, Math.max(LARGE_PASTE_MIN_CHARS, Math.round(value)))
    : fallback

/** Validate the persisted `largePaste` setting; anything unreadable falls back to the defaults. */
export const resolveLargePaste = (value: unknown): LargePasteThresholds => {
  const record = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
  const promptChars = clampChars(record.promptChars, LARGE_TEXT_PROMPT_THRESHOLD)
  return { promptChars, attachChars: Math.max(promptChars, clampChars(record.attachChars, LARGE_TEXT_FORCE_THRESHOLD)) }
}

/** Set by App from the settings, read at paste time by every pane in the window. */
let thresholds = resolveLargePaste(undefined)

export const setLargePasteThresholds = (value: unknown): void => {
  thresholds = resolveLargePaste(value)
}

export const largePasteThresholds = (): LargePasteThresholds => thresholds

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
export const saveTextAsAttachment = async (
  text: string,
  sessionId?: string,
): Promise<SavedAttachment | null> => {
  const nameHint = detectTextAttachmentName(text)
  const bytes = new TextEncoder().encode(text)
  try {
    const info = await window.omnitermAPI.attachments?.save(nameHint, bytes, sessionId)
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
  canInsertImagePaths?: boolean
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
  canInsertImagePaths,
  promptDecision = requestLargeTextPasteDecision,
}: HandleLargeTextPasteOptions): Promise<boolean> => {
  const { promptChars, attachChars } = largePasteThresholds()
  if (text.length < promptChars) {
    noteLocalEcho()
    term.paste(text)
    return true
  }

  const attachDirectly = async (): Promise<boolean> => {
    const saved = await saveTextAsAttachment(text, sessionId)
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

  const canInsert = canInsertImagePaths ?? true
  if (canInsert && text.length > attachChars) {
    return attachDirectly()
  }

  // Between the two thresholds (or above attachChars for unconfirmed agent): prompt the user
  const charCount = text.length
  const lineCount = countLines(text)
  const preview = createTextPreview(text)
  const effectiveSessionId = sessionId ?? 'active'
  const decision = await promptDecision(effectiveSessionId, text, charCount, lineCount, preview)
  try {
    if (decision === 'attach') {
      return await attachDirectly()
    }
    if (decision === 'paste') {
      noteLocalEcho()
      term.paste(text)
      return true
    }
    return false
  } finally {
    refocus(term)
  }
}

/**
 * The dialog took the keyboard (its default button is focused), so whatever the user chose —
 * even Cancel — the pane they pasted into gets it back. Once more after the dialog has unmounted,
 * because removing the focused button would leave the focus on the page body.
 */
const refocus = (term: Terminal): void => {
  term.focus()
  setTimeout(() => term.focus(), 0)
}
