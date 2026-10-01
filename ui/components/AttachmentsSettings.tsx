import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, RefreshCw, Trash2 } from 'lucide-react'

import { formatBytes, type AttachmentClearReport, type AttachmentListing } from '../utils/attachmentTypes'
import { LARGE_PASTE_MAX_CHARS, LARGE_PASTE_MIN_CHARS, resolveLargePaste, type LargePasteThresholds } from '../utils/largeTextPaste'

const LABEL_CLS = 'text-[10px] text-theme-fg uppercase font-bold tracking-widest ml-0.5'
const BUTTON_CLS = 'flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-theme-dim hover:text-theme-fg bg-theme-bg border border-theme-border hover:border-theme-accent rounded-lg transition-colors disabled:opacity-40'

const FIELD_CLS = 'w-28 px-2 py-1 text-[11px] text-theme-fg bg-theme-bg border border-theme-border focus:border-theme-accent rounded-lg outline-none tabular-nums'

/**
 * One threshold as a number field. The draft is only committed on blur or Enter, so typing
 * "5000" does not save 5, 50 and 500 on the way — and a value out of range is clamped then.
 */
function ThresholdField({ id, label, value, onCommit }: { id: string; label: string; value: number; onCommit: (chars: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const chars = Number(draft)
    if (Number.isFinite(chars) && draft.trim() !== '') onCommit(chars)
    else setDraft(String(value))
  }
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-2 text-[11px] text-theme-fg">
      <span>{label}</span>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={LARGE_PASTE_MIN_CHARS}
        max={LARGE_PASTE_MAX_CHARS}
        step={100}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') commit() }}
        className={FIELD_CLS}
      />
    </label>
  )
}

const summaryOf = (listing: AttachmentListing) => ({
  count: listing.files.length,
  bytes: listing.files.reduce((total, file) => total + file.size, 0),
})

const resultText = ({ removed, bytes, failed }: AttachmentClearReport): string =>
  `Deleted ${removed} file${removed === 1 ? '' : 's'} (${formatBytes(bytes)}).${failed > 0 ? ` ${failed} still in use were kept.` : ''}`

export interface AttachmentsSettingsProps {
  /** The persisted `largePaste` setting, validated here before it is shown. */
  largePaste?: unknown
  onLargePasteChange: (largePaste: LargePasteThresholds) => void
}

/**
 * Settings → General → Attachments: when a large text paste into an agent pane becomes a document,
 * how much the images and files pasted or dropped into agent panes take on disk, a way to review
 * them in Explorer, and a confirmed "Clear all". Agents only read an attachment when it is sent, so
 * clearing never affects a running session's history.
 */
export default function AttachmentsSettings({ largePaste, onLargePasteChange }: AttachmentsSettingsProps) {
  const thresholds = resolveLargePaste(largePaste)
  const [listing, setListing] = useState<AttachmentListing | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setListing(await window.omnitermAPI.attachments.list())
    } catch {
      setListing({ dir: '', files: [] })
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const clearAll = async () => {
    setConfirming(false)
    try {
      setResult(resultText(await window.omnitermAPI.attachments.clear()))
    } catch {
      setResult('Could not clear the attachments folder.')
    }
    await refresh()
  }

  const summary = listing ? summaryOf(listing) : null
  return (
    <div className="flex flex-col gap-1.5 border-t border-theme-border pt-3" aria-label="Attachments" role="group">
      <span className={LABEL_CLS}>Attachments</span>
      <p className="text-[11px] text-theme-dim -mt-0.5">
        Images, files, and large text pasted or dropped into an AI agent pane are stored here so the agent can read them.
      </p>
      <div className="flex flex-col gap-1.5 p-2 rounded-lg border border-theme-border" role="group" aria-label="Large text paste">
        <ThresholdField
          id="large-paste-prompt"
          label="Ask to attach pasted text from (characters)"
          value={thresholds.promptChars}
          onCommit={(promptChars) => onLargePasteChange(resolveLargePaste({ ...thresholds, promptChars }))}
        />
        <ThresholdField
          id="large-paste-attach"
          label="Attach as a document without asking above (characters)"
          value={thresholds.attachChars}
          onCommit={(attachChars) => onLargePasteChange(resolveLargePaste({ ...thresholds, attachChars }))}
        />
        <p className="text-[11px] text-theme-dim">
          Shorter pastes go straight into the agent&apos;s prompt. Set both to the same number to never be asked.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-theme-fg flex-1 min-w-0" data-testid="attachments-summary">
          {summary ? `${summary.count} file${summary.count === 1 ? '' : 's'} · ${formatBytes(summary.bytes)} stored` : 'Checking…'}
        </span>
        <button type="button" aria-label="Refresh attachments summary" onClick={() => void refresh()} className={BUTTON_CLS}>
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button type="button" disabled={!listing?.dir} onClick={() => listing?.dir && void window.omnitermAPI.app.openInSystem(listing.dir)} className={BUTTON_CLS}>
          <FolderOpen className="w-3.5 h-3.5" /> Open folder
        </button>
        <button type="button" disabled={!summary || summary.count === 0} onClick={() => { setResult(null); setConfirming(true) }} className={BUTTON_CLS}>
          <Trash2 className="w-3.5 h-3.5" /> Clear all…
        </button>
      </div>
      {confirming && summary && (
        <div className="flex flex-wrap items-center gap-2 mt-1 p-2 rounded-lg border border-theme-border bg-theme-bg" role="alertdialog" aria-label="Confirm clearing attachments">
          <span className="text-[11px] text-theme-dim flex-1 min-w-0">
            Delete {summary.count} file{summary.count === 1 ? '' : 's'} ({formatBytes(summary.bytes)})? Agents that still refer to them by path will not find them.
          </span>
          <button
            type="button"
            onClick={() => void clearAll()}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-theme-error bg-theme-bg border border-theme-error rounded-lg transition-colors"
          >
            Delete
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={BUTTON_CLS}>Cancel</button>
        </div>
      )}
      {result && <span role="status" className="text-[11px] text-theme-dim">{result}</span>}
    </div>
  )
}
