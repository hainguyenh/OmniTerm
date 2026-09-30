import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ExternalLink, FileText, FolderOpen, Image as ImageIcon, Paperclip, Plus } from 'lucide-react'

import { usePanePresence } from '../utils/agentPresenceStore'
import { formatAttachmentPaths, saveAttachmentFiles } from '../utils/attachmentInput'
import { canOpenAttachment, formatBytes } from '../utils/attachmentTypes'
import { getPastedImages, requestOpen, subscribePastedImage } from '../utils/pastedImageStore'
import { getSessionAttachments, recordSavedAttachments, subscribeSessionAttachments, type SessionAttachment } from '../utils/sessionAttachmentStore'
import { formatTimeAgo } from '../utils/storedSessionResume'
import { Tooltip } from './Tooltip'

const ITEM_BTN = 'w-5 h-5 flex items-center justify-center rounded text-theme-dim hover:bg-[#414868] hover:text-theme-accent'

const openFolder = async () => {
  const { dir } = await window.omnitermAPI.attachments.list()
  if (dir) await window.omnitermAPI.app.openInSystem(dir)
}

function AttachmentRow({ sessionId, item, thumbnail, now }: {
  sessionId: string
  item: SessionAttachment
  thumbnail?: string
  now: number
}) {
  return (
    <li className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-theme-bg" data-testid="attachment-row">
      {thumbnail
        ? <img src={thumbnail} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0 border border-theme-border" />
        : <FileText className="w-4 h-4 m-2 flex-shrink-0 text-theme-dim" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] text-theme-fg" title={item.path}>{item.name}</span>
        <span className="block text-[10px] text-theme-dim">{formatBytes(item.size)} · {formatTimeAgo(item.at, now)}</span>
      </span>
      {thumbnail && (
        <button type="button" className={ITEM_BTN} aria-label={`View ${item.name}`} onClick={() => requestOpen(sessionId)}>
          <ImageIcon className="w-3 h-3" />
        </button>
      )}
      {canOpenAttachment(item.name) && (
        <button type="button" className={ITEM_BTN} aria-label={`Open ${item.name}`} onClick={() => void window.omnitermAPI.app.openInSystem(item.path)}>
          <ExternalLink className="w-3 h-3" />
        </button>
      )}
    </li>
  )
}

/**
 * The footer's paperclip: what this pane attached (pasted or dropped images and files), each one
 * viewable or openable, and a way to the attachment folder in Explorer. Shown on agent panes and on
 * any pane that has attached something.
 */
export function AttachmentsFooterButton({ sessionId }: { sessionId: string }) {
  const agent = usePanePresence(sessionId)
  const items = useSyncExternalStore(
    (cb) => subscribeSessionAttachments(sessionId, cb),
    () => getSessionAttachments(sessionId),
  )
  const images = useSyncExternalStore(
    (cb) => subscribePastedImage(sessionId, cb),
    () => getPastedImages(sessionId),
  )
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleAttachFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    const saved = await saveAttachmentFiles(files)
    if (saved.length === 0) return
    recordSavedAttachments(sessionId, saved)
    const paths = formatAttachmentPaths(saved.map(({ info }) => info.path))
    if (paths) {
      window.omnitermAPI?.connect?.localInput?.(sessionId, paths)
    }
  }

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!agent && items.length === 0) return null
  const thumbnails = new Map(images.map((image) => [image.path, image.objectUrl]))
  const label = items.length === 0 ? 'Attachments' : `Attachments (${items.length})`
  const now = Date.now()

  return (
    <span ref={rootRef} className="relative flex-shrink-0">
      <Tooltip content="Images and files attached in this pane" placement="top">
        <button
          type="button"
          aria-label={label}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={`inline-flex items-center gap-0.5 h-5 px-1 rounded text-[10px] transition-colors ${open ? 'text-theme-accent bg-[#414868]' : 'text-theme-dim hover:text-theme-accent hover:bg-[#414868]'}`}
        >
          <Paperclip className="w-3 h-3" />
          {items.length > 0 && <span className="tabular-nums">{items.length}</span>}
        </button>
      </Tooltip>
      {open && (
        <div role="dialog" aria-label="Attachments in this pane"
          className="absolute bottom-full right-0 mb-1 w-72 max-h-80 flex flex-col rounded-xl border border-theme-border bg-theme-popup shadow-2xl text-xs"
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 border-b border-theme-border text-[11px] font-medium text-theme-accent hover:bg-white/5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Attach files...
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleAttachFiles}
            data-testid="attachment-file-input"
          />
          {items.length === 0
            ? <p className="p-3 text-[11px] text-theme-dim">Paste (Ctrl+V) or drop images and files here to attach them to the agent.</p>
            : (
              <ul className="p-1 overflow-y-auto custom-scrollbar">
                {[...items].reverse().map((item) => (
                  <AttachmentRow key={item.path} sessionId={sessionId} item={item} thumbnail={thumbnails.get(item.path)} now={now} />
                ))}
              </ul>
            )}
          <button type="button" onClick={() => void openFolder()}
            className="flex items-center gap-1.5 px-3 py-2 border-t border-theme-border text-[11px] text-theme-dim hover:text-theme-accent"
          >
            <FolderOpen className="w-3.5 h-3.5" /> Open attachments folder
          </button>
        </div>
      )}
    </span>
  )
}
