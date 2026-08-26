import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Check, Copy, Image as ImageIcon, X } from 'lucide-react'
import {
  getLastPastedImage,
  subscribeOpen,
  subscribePastedImage,
  type PastedImage,
} from '../utils/pastedImageStore'
import { writeClipboardText } from '../utils/terminalClipboard'

/**
 * Full-resolution viewer for the last image pasted into one pane. Lives in the pane's webview,
 * so it shows the real bitmap where a TUI agent (OpenCode, Claude Code…) can only draw the same
 * PNG as unreadable cell-block art. Renders nothing until the pane header's image button sends
 * an open request AND a pasted image exists; shows the slot's current image, so a paste made
 * while open swaps the displayed image in place (the store revokes the old URL only after the
 * new one exists).
 */
const PastedImageViewerHost: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const [open, setOpen] = useState(false)
  const image = useSyncExternalStore(
    (cb) => subscribePastedImage(sessionId, cb),
    () => getLastPastedImage(sessionId),
  )

  useEffect(() => subscribeOpen(sessionId, () => setOpen(true)), [sessionId])

  // Slot emptied (image released): close rather than render a dead URL.
  useEffect(() => {
    if (!image) setOpen(false)
  }, [image])

  if (!open || !image) return null
  return <PastedImageViewer image={image} onClose={() => setOpen(false)} />
}

const PastedImageViewer: React.FC<{ image: PastedImage; onClose: () => void }> = ({ image, onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [copied, setCopied] = useState(false)

  // Escape closes; focus lands on the close button on open and returns to its previous owner
  // on dismiss — same focus contract as ConfirmDialog.
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
      previousFocus?.focus()
    }
  }, [onClose])

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  const copyPath = () => {
    void writeClipboardText(image.path).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-6"
      onClick={handleBackdrop}
      role="presentation"
    >
      <div
        className="bg-theme-popup border border-theme-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-w-[90vw]"
        role="dialog"
        aria-modal="true"
        aria-label="Last pasted image"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-theme-border">
          <ImageIcon className="w-3.5 h-3.5 text-theme-accent flex-shrink-0" />
          <span className="text-xs text-theme-fg font-semibold flex-shrink-0">Last pasted image</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-theme-dim font-normal" title={image.path}>
            {image.path}
          </span>
          <button
            type="button"
            onClick={copyPath}
            className="w-5 h-5 flex items-center justify-center rounded text-theme-dim hover:bg-[#414868] hover:text-theme-accent transition-colors"
            aria-label="Copy image path"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-theme-accent" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center rounded text-theme-dim hover:bg-theme-error/20 hover:text-theme-error transition-colors"
            aria-label="Close image viewer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {/* Natural size up to the viewport: never upscaled, never cropped — object-contain keeps
            tall screenshots fully visible inside the dialog box. */}
        <img
          src={image.objectUrl}
          alt="Last image pasted into this pane"
          className="max-h-[80vh] max-w-[90vw] object-contain bg-black"
        />
      </div>
    </div>
  )
}

export default PastedImageViewerHost
