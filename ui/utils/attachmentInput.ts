/**
 * Files pasted or dropped into an AI agent pane. An agent attaches a file by path, so each file is
 * first stored in the app's attachment folder (src-tauri/src/attachments.rs) and its stored path —
 * not the user's original — is what reaches the PTY. That keeps every attachment in one place the
 * user can review from the pane footer and clear from Settings.
 */
import type { AttachmentInfo } from './attachmentTypes'

/** Mirrors `MAX_ATTACHMENT_BYTES` in app-core, so an oversized file is skipped before it is read. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

/** A stored attachment, with its bytes when it is an image (for the pane's image viewer). */
export interface SavedAttachment {
  info: AttachmentInfo
  bytes?: Uint8Array
}

/**
 * Paths as typed into the prompt: space-separated, a path with whitespace in double quotes. Claude
 * Code, Codex and PowerShell all read a quoted path as one argument.
 */
export const formatAttachmentPaths = (paths: readonly string[]): string =>
  paths.map((path) => (/\s/.test(path) ? `"${path}"` : path)).join(' ')

/** Store each file; a file that is empty, too large or refused by the backend is skipped. */
export const saveAttachmentFiles = async (files: readonly File[]): Promise<SavedAttachment[]> => {
  const saved: SavedAttachment[] = []
  for (const file of files) {
    if (file.size === 0 || file.size > MAX_ATTACHMENT_BYTES) continue
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const info = await window.omnitermAPI.attachments.save(file.name, bytes)
      if (info) saved.push(info.kind === 'image' ? { info, bytes } : { info })
    } catch {
      // Unreadable or refused (size, disk): leave this file out; the rest still attach.
    }
  }
  return saved
}

const carriesFiles = (event: DragEvent): boolean =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files')

/**
 * Accept files dragged from Explorer/Finder onto `element` while `canAccept()` (an agent pane).
 * Pane rearranging drags carry text, not files, so they pass through untouched. Returns a disposer.
 */
export const installAttachmentDrop = (
  element: HTMLElement,
  canAccept: () => boolean,
  onFiles: (files: File[]) => void,
): (() => void) => {
  const onDragOver = (event: DragEvent) => {
    if (!carriesFiles(event) || !canAccept()) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (event: DragEvent) => {
    if (!carriesFiles(event) || !canAccept()) return
    event.preventDefault()
    event.stopPropagation()
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length > 0) onFiles(files)
  }
  element.addEventListener('dragover', onDragOver)
  element.addEventListener('drop', onDrop)
  return () => {
    element.removeEventListener('dragover', onDragOver)
    element.removeEventListener('drop', onDrop)
  }
}
