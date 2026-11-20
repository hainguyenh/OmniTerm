/**
 * A copy of what was pasted into an agent pane, kept on the pane's attachment list so the user can
 * read back later what they handed the agent. The text still goes into the prompt as typed; this
 * only stores a file beside it (the app's attachment folder, like a pasted image).
 *
 * A short one-line paste (a word, a branch name) is not worth a file. The same text pasted twice
 * reuses its first copy, which moves to the end of the list.
 */
import type { SavedAttachment } from './attachmentInput'

/** From this many characters (or any line break), a paste is kept for review. */
export const PASTE_REVIEW_MIN_CHARS = 80
/** Copies remembered per pane for the reuse check; older texts are stored again if re-pasted. */
const REMEMBERED_PER_PANE = 20

type SaveText = (text: string, sessionId: string) => Promise<SavedAttachment | null>

const kept = new Map<string, Map<string, SavedAttachment>>()

export const isWorthReview = (text: string): boolean => {
  const trimmed = text.trim()
  return trimmed.length >= PASTE_REVIEW_MIN_CHARS || /[\r\n]/.test(trimmed)
}

/** Store `text` as an attachment of the pane and hand it to `onSaved`; a failed save is ignored. */
export const keepPasteForReview = async (
  text: string,
  sessionId: string | undefined,
  save: SaveText,
  onSaved: ((saved: SavedAttachment[]) => void) | undefined,
): Promise<void> => {
  if (!sessionId || !onSaved || !isWorthReview(text)) return
  let pane = kept.get(sessionId)
  const known = pane?.get(text)
  if (known) {
    onSaved([known])
    return
  }
  const saved = await save(text, sessionId)
  if (!saved) return
  if (!pane) {
    pane = new Map()
    kept.set(sessionId, pane)
  }
  pane.set(text, saved)
  const oldest = pane.keys().next()
  if (pane.size > REMEMBERED_PER_PANE && !oldest.done) pane.delete(oldest.value)
  onSaved([saved])
}

/** Pane unmount: forget its remembered copies (the files stay in the attachment folder). */
export const forgetPasteReview = (sessionId: string | null): void => {
  if (sessionId) kept.delete(sessionId)
}
