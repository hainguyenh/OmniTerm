import React, { useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Paperclip, Terminal as TerminalIcon, X } from 'lucide-react'

import {
  getLargeTextPasteRequest,
  resolveLargeTextPaste,
  subscribeLargeTextPaste,
  type LargeTextPasteRequest,
} from '../utils/largeTextPasteStore'

const LargeTextPasteModal: React.FC<{ request: LargeTextPasteRequest }> = ({ request }) => {
  const { charCount, lineCount, preview } = request

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        resolveLargeTextPaste('cancel')
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        e.stopPropagation()
        resolveLargeTextPaste('paste')
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        resolveLargeTextPaste('attach')
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[80]"
      onClick={(e) => {
        if (e.target === e.currentTarget) resolveLargeTextPaste('cancel')
      }}
      role="presentation"
    >
      <div
        className="bg-theme-popup w-full max-w-lg rounded-2xl border border-theme-border shadow-2xl overflow-hidden flex flex-col p-5 gap-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="large-text-paste-title"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-theme-accent/15 flex items-center justify-center text-theme-accent">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 id="large-text-paste-title" className="text-sm font-bold text-theme-fg">
                Large Text Paste
              </h3>
              <p className="text-[11px] text-theme-dim">
                {charCount.toLocaleString()} characters · {lineCount} line{lineCount === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cancel paste"
            onClick={() => resolveLargeTextPaste('cancel')}
            className="p-1 rounded-lg text-theme-dim hover:text-theme-fg hover:bg-theme-bg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-theme-fg leading-relaxed">
          Pasting large text into an AI agent prompt can cause terminal wrapping and buffer lag.
          Would you like to attach this text as a document instead?
        </p>

        {preview && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-theme-dim uppercase font-bold tracking-wider">
              Preview
            </span>
            <div className="max-h-28 overflow-y-auto p-2.5 rounded-lg bg-theme-bg border border-theme-border font-mono text-[11px] text-theme-dim whitespace-pre-wrap break-all custom-scrollbar select-text">
              {preview}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1 border-t border-theme-border">
          <button
            type="button"
            onClick={() => resolveLargeTextPaste('cancel')}
            className="px-3 py-1.5 rounded-xl text-xs text-theme-dim hover:text-theme-fg hover:bg-theme-bg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => resolveLargeTextPaste('paste')}
            className="px-3.5 py-1.5 rounded-xl border border-theme-border text-theme-fg hover:border-theme-accent hover:text-theme-accent transition-colors text-xs font-medium flex items-center gap-1.5"
            title="Paste raw text directly into the terminal (Ctrl+Enter)"
          >
            <TerminalIcon className="w-3.5 h-3.5" />
            Paste Directly
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => resolveLargeTextPaste('attach')}
            className="px-3.5 py-1.5 rounded-xl bg-theme-accent hover:brightness-110 text-theme-accent-fg transition-colors text-xs font-semibold flex items-center gap-1.5 shadow-sm"
            title="Save as document and paste path (Enter)"
          >
            <Paperclip className="w-3.5 h-3.5" />
            Attach as Document
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Host for the large text paste confirmation dialog.
 * Portaled to document.body to avoid clipping inside blurred or transformed terminal panes.
 */
export default function LargeTextPasteModalHost() {
  const request = useSyncExternalStore(subscribeLargeTextPaste, getLargeTextPasteRequest)
  if (!request) return null
  return createPortal(<LargeTextPasteModal request={request} />, document.body)
}
