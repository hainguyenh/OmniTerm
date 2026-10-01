/**
 * The attachment folder's IPC contract (src-tauri/src/attachments.rs): images and files pasted or
 * dropped into an agent pane are stored there so the user can review and clear them.
 *
 * Everything the backend returns is validated here before the UI trusts it — a malformed row is
 * dropped, never rendered or handed to `openInSystem`.
 */

export type AttachmentKind = 'image' | 'file'

export interface AttachmentInfo {
  name: string
  path: string
  size: number
  modifiedMs: number
  kind: AttachmentKind
}

export interface AttachmentListing {
  dir: string
  files: AttachmentInfo[]
}

export interface AttachmentClearReport {
  removed: number
  bytes: number
  failed: number
}

export interface ClipboardAPI {
  writeText: (text: string) => Promise<void>
  readText: () => Promise<string>
  /** Native RGBA clipboard read; null when the clipboard holds no image or the read fails. */
  readImage: () => Promise<{ rgba: Uint8Array; width: number; height: number } | null>
  /** Persist clipboard-image bytes as a PNG attachment; resolves to its absolute path. */
  saveImageTemp: (bytes: Uint8Array, sessionId?: string) => Promise<string>
}

export interface AttachmentsAPI {
  /** Store one dropped or pasted file; `name` is only a hint the backend sanitizes. */
  save: (name: string, bytes: Uint8Array, sessionId?: string) => Promise<AttachmentInfo | null>
  /** Copy the files Explorer put on the clipboard into the folder (Windows); empty otherwise. */
  importClipboardFiles: (sessionId?: string) => Promise<AttachmentInfo[]>
  list: (sessionId?: string) => Promise<AttachmentListing>
  clear: (sessionId?: string) => Promise<AttachmentClearReport>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

export const parseAttachmentInfo = (value: unknown): AttachmentInfo | null => {
  if (!isRecord(value)) return null
  const { name, path, size, modifiedMs, kind } = value
  if (typeof name !== 'string' || name.length === 0 || typeof path !== 'string' || path.length === 0) return null
  if (!isCount(size) || !isCount(modifiedMs) || (kind !== 'image' && kind !== 'file')) return null
  return { name, path, size, modifiedMs, kind }
}

export const parseAttachmentList = (value: unknown): AttachmentInfo[] =>
  Array.isArray(value) ? value.map(parseAttachmentInfo).filter((info): info is AttachmentInfo => info !== null) : []

export const parseAttachmentListing = (value: unknown): AttachmentListing => {
  if (!isRecord(value)) return { dir: '', files: [] }
  return { dir: typeof value.dir === 'string' ? value.dir : '', files: parseAttachmentList(value.files) }
}

export const parseClearReport = (value: unknown): AttachmentClearReport => {
  const record = isRecord(value) ? value : {}
  const count = (field: unknown) => (isCount(field) ? field : 0)
  return { removed: count(record.removed), bytes: count(record.bytes), failed: count(record.failed) }
}

/** `2.4 MB`, `812 KB`, `90 B` — for attachment rows and the settings summary. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Types the OS may open with its default app from the attachment list. Anything else (scripts,
 * installers, shortcuts) is only reachable through its folder — an attachment never runs on a click.
 */
const OPENABLE = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'pdf', 'txt', 'md', 'csv', 'json', 'log', 'xml',
  'yaml', 'yml', 'rtf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'zip',
])

export const canOpenAttachment = (name: string): boolean => {
  const dot = name.lastIndexOf('.')
  return dot > 0 && OPENABLE.has(name.slice(dot + 1).toLowerCase())
}
