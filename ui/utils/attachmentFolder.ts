/**
 * Which stored folder a pane's attachments go to. Once the pane's AI agent has a session id the
 * files are kept under it, so they belong to the conversation and outlive the pane; until then
 * they wait in a temporary folder named after the pane, and `moveToSessionFolder` merges that into
 * the session's the moment the id appears.
 */
import { getPanePresence } from './agentPresenceStore'
import { repointPastedImages } from './pastedImageStore'
import { repointSessionAttachments } from './sessionAttachmentStore'

/** The agent's real session id, if known (`latest` is only a placeholder for "not resolved"). */
export const agentSessionIdOf = (paneId: string | null | undefined): string | undefined => {
  const presence = getPanePresence(paneId)
  const id = presence?.agentSessionId ?? presence?.claudeSessionId
  return id && id !== 'latest' ? id : undefined
}

/** The folder key new attachments of this pane are saved under. */
export const attachmentFolderFor = <T extends string | undefined>(paneId: T): T | string =>
  (paneId ? agentSessionIdOf(paneId) : undefined) ?? paneId

/**
 * Merge the pane's temporary folder into the agent session's and re-point the pane's list and
 * image previews at the moved files. Safe to repeat: an empty or missing temporary folder moves nothing.
 */
export const moveToSessionFolder = async (paneId: string, sessionId: string): Promise<void> => {
  if (paneId === sessionId) return
  try {
    const moved = await window.omnitermAPI.attachments.move(paneId, sessionId)
    if (moved.length === 0) return
    const byPath = new Map(moved.map((item) => [item.from, item.to]))
    repointSessionAttachments(paneId, byPath)
    repointPastedImages(paneId, byPath)
  } catch {
    // The files stay in the temporary folder; their paths keep working.
  }
}
