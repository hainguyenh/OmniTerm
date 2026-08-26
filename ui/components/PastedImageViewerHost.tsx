import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronLeft, ChevronRight, Copy, Image as ImageIcon, X } from 'lucide-react'
import {
  getPastedImages,
  subscribeOpen,
  subscribePastedImage,
  type PastedImage,
} from '../utils/pastedImageStore'
import { writeClipboardText } from '../utils/terminalClipboard'

/**
 * Full-resolution viewer for the images pasted into one pane. Lives in the pane's webview, so it
 * shows the real bitmap where a TUI agent (OpenCode, Claude Code…) can only draw the same PNG as
 * unreadable cell-block art. Renders nothing until the pane header's image button sends an open
 * request AND a pasted image exists; shows the history's current image, so a paste made while open
 * jumps to the newest one and chevrons / Left-Right flip back through earlier pastes.
 *
 * The overlay is portaled to `document.body`: the host renders inside `.terminal-pane`, whose
 * `filter: blur(...)` (unfocused-pane blur) would otherwise become the containing block for
 * `position: fixed` (clipping the dialog to the pane) and a stacking context that loses to the
 * tab strip's `z-30` chrome.
 */
const PastedImageViewerHost: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const [open, setOpen] = useState(false)
  const images = useSyncExternalStore(
    (cb) => subscribePastedImage(sessionId, cb),
    () => getPastedImages(sessionId),
  )
  // null = "follow the newest paste"; an explicit index survives until a new paste lands.
  const [viewIndex, setViewIndex] = useState<number | null>(null)
  const previousCount = useRef(images.length)

  useEffect(() => subscribeOpen(sessionId, () => setOpen(true)), [sessionId])

  // A paste made while the viewer is open jumps to the new image; an explicit index that fell out
  // of range (release/eviction) falls back to the newest.
  useEffect(() => {
    if (images.length > previousCount.current) setViewIndex(null)
    previousCount.current = images.length
  }, [images.length])

  // History emptied (released): close rather than render dead URLs.
  useEffect(() => {
    if (images.length === 0) setOpen(false)
  }, [images.length])

  if (!open || images.length === 0) return null
  return (
    <PastedImageViewer
      images={images}
      viewIndex={viewIndex}
      onViewIndexChange={setViewIndex}
      onClose={() => { setViewIndex(null); setOpen(false) }}
    />
  )
}

const PastedImageViewer: React.FC<{
  images: PastedImage[]
  viewIndex: number | null
  onViewIndexChange: (index: number | null) => void
  onClose: () => void
}> = ({ images, viewIndex, onViewIndexChange, onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [copied, setCopied] = useState(false)
  const index = Math.min(viewIndex ?? images.length - 1, images.length - 1)
  const image = images[index]
  const multiple = images.length > 1

  const showPrevious = () => onViewIndexChange(Math.max(0, index - 1))
  const showNext = () => onViewIndexChange(Math.min(images.length - 1, index + 1))

  // Escape closes; Left/Right flip through the history when several pastes exist. Focus lands on
  // the close button on open and returns to its previous owner on dismiss — same focus contract
  // as ConfirmDialog. Re-registered every render (no deps) so the handlers always see the
  // current index and bounds; add/remove on the same document node is cheap.
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowLeft' && multiple) {
        e.preventDefault()
        showPrevious()
      } else if (e.key === 'ArrowRight' && multiple) {
        e.preventDefault()
        showNext()
      }
    }
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
      previousFocus?.focus()
    }
  })

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  const copyPath = () => {
    void writeClipboardText(image.path).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  return createPortal(
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
          <ImageIcon className="w-3.5 h-3.5 text-theme-accent flex-shrink-0" aria-hidden="true" />
          <span className="text-xs text-theme-fg font-semibold flex-shrink-0">Last pasted image</span>
          {multiple && (
            <>
              <button
                type="button"
                onClick={showPrevious}
                disabled={index === 0}
                className="w-5 h-5 flex items-center justify-center rounded text-theme-dim hover:bg-theme-hover hover:text-theme-fg transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                aria-label="Previous image"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] text-theme-dim font-mono flex-shrink-0" aria-live="polite">
                {index + 1} / {images.length}
              </span>
              <button
                type="button"
                onClick={showNext}
                disabled={index === images.length - 1}
                className="w-5 h-5 flex items-center justify-center rounded text-theme-dim hover:bg-theme-hover hover:text-theme-fg transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                aria-label="Next image"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <span className="min-w-0 flex-1 truncate text-[11px] text-theme-dim font-normal" title={image.path}>
            {image.path}
          </span>
          <button
            type="button"
            onClick={copyPath}
            className="w-5 h-5 flex items-center justify-center rounded text-theme-dim hover:bg-theme-hover hover:text-theme-accent transition-colors"
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
    </div>,
    document.body,
  )
}

export default PastedImageViewerHost
