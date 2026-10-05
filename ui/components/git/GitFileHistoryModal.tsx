import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, History, Loader2, X } from 'lucide-react'

import { createGitAPI } from '../../gitAPI'
import { GitFileHistoryDiff } from './GitFileHistoryDiff'
import {
  formatCommitDate, historySides, moveSelection, type GitHistoryCompareMode,
} from './gitFileHistoryUtils'
import type { GitFileHistoryEntry, GitLineRange } from './gitTypes'

interface GitFileHistoryModalProps {
  cwd: string
  /** Repository-relative path of the file as it is named today. */
  filePath: string
  /** Limit the history to commits that changed these lines. */
  range?: GitLineRange
  onClose: () => void
}

const MODES: { mode: GitHistoryCompareMode; label: string }[] = [
  { mode: 'commit', label: 'Changes in commit' },
  { mode: 'working', label: 'Compare with working copy' },
]

/**
 * Commits that touched a file (or a line range of it) on the left, the selected commit's change to
 * the file on the right — the editor's "Git: File history" and "History of selection".
 */
export function GitFileHistoryModal({ cwd, filePath, range, onClose }: GitFileHistoryModalProps) {
  const [entries, setEntries] = useState<GitFileHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [mode, setMode] = useState<GitHistoryCompareMode>('commit')
  const [fullFile, setFullFile] = useState(false)
  const [copied, setCopied] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current) }, [])
  const start = range?.start
  const end = range?.end

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    const lines = start !== undefined && end !== undefined ? { start, end } : undefined
    createGitAPI().getFileHistory(cwd, filePath, lines).then(
      (result) => {
        if (!active) return
        setEntries(result)
        setIndex(0)
        setLoading(false)
      },
      (err: unknown) => {
        if (!active) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      },
    )
    return () => { active = false }
  }, [cwd, filePath, start, end])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // The diff's search panel takes Escape first.
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [index])

  const sides = useMemo(() => historySides(entries, index, mode, filePath), [entries, index, mode, filePath])
  const selected = entries[index]

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (!delta) return
    event.preventDefault()
    setIndex((value) => moveSelection(value, delta, entries.length))
  }

  const copyId = () => {
    if (!selected) return
    void navigator.clipboard.writeText(selected.commit.id).then(() => {
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1500)
    })
  }

  const title = range ? `Lines ${range.start}–${range.end}` : null

  const content = (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-150"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={`Git history: ${filePath}`}
    >
      <div className="git-menu w-full max-w-6xl h-[85vh] bg-theme-bg border border-theme-border rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs text-theme-fg animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-theme-border bg-theme-sidebar flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <History className="w-4 h-4 text-theme-accent flex-shrink-0" />
            <span className="font-semibold text-theme-fg">{range ? 'Selection History:' : 'File History:'}</span>
            <span className="font-mono text-theme-accent truncate" title={filePath}>{filePath}</span>
            {title && <span className="text-[10px] px-1.5 rounded bg-theme-accent/20 text-theme-accent flex-shrink-0">{title}</span>}
          </div>
          <button type="button" onClick={onClose} title="Close (Esc)" aria-label="Close history"
            className="p-1 rounded hover:bg-theme-hover hover:text-theme-fg transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-1.5 border-b border-theme-border/60 bg-theme-sidebar/40 flex-shrink-0">
          <div className="flex items-center gap-2" role="group" aria-label="Compare mode">
            {MODES.map(({ mode: value, label }) => (
              <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                  mode === value ? 'bg-theme-accent text-white' : 'text-theme-dim hover:text-theme-fg'
                }`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-theme-dim">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={fullFile} onChange={(e) => setFullFile(e.target.checked)} />
              <span>Full file</span>
            </label>
            {!loading && <span className="font-mono">{entries.length} commit(s)</span>}
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          <div
            ref={listRef}
            role="listbox"
            aria-label="Commits"
            tabIndex={0}
            onKeyDown={onListKeyDown}
            className="w-72 flex-shrink-0 overflow-y-auto border-r border-theme-border custom-scrollbar outline-none"
          >
            {loading ? (
              <div className="flex items-center justify-center p-8 gap-2 text-theme-dim">
                <Loader2 className="w-4 h-4 animate-spin text-theme-accent" />
                <span>Loading history...</span>
              </div>
            ) : error ? (
              <div className="p-6 text-center text-theme-error select-text">{error}</div>
            ) : entries.length === 0 ? (
              <div className="p-6 text-center text-theme-dim">No commits found for this file.</div>
            ) : entries.map((entry, i) => (
              <div
                key={entry.commit.id}
                role="option"
                aria-selected={i === index}
                data-index={i}
                onClick={() => setIndex(i)}
                className={`px-3 py-2 border-b border-theme-border/30 cursor-pointer transition-colors ${
                  i === index ? 'bg-theme-accent/15' : 'hover:bg-theme-hover'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[10px] text-theme-accent font-semibold flex-shrink-0">{entry.commit.short_id}</span>
                  <span className="text-[11px] font-medium text-theme-fg truncate" title={entry.commit.summary}>{entry.commit.summary}</span>
                </div>
                <div className="text-[10px] text-theme-dim mt-0.5 truncate">
                  {entry.commit.author_name} · {formatCommitDate(entry.commit.timestamp)}
                </div>
                {entry.path !== filePath && (
                  <div className="text-[10px] text-theme-dim/80 mt-0.5 truncate font-mono" title={entry.path}>as {entry.path}</div>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-col flex-1 min-w-0">
            {selected && (
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-theme-border/60 flex-shrink-0">
                <div className="min-w-0 truncate text-theme-dim">
                  <span className="text-theme-fg font-medium">{selected.commit.summary}</span>
                  {' · '}{selected.commit.author_name} &lt;{selected.commit.author_email}&gt;
                </div>
                <button type="button" onClick={copyId} title="Copy commit hash"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-theme-border hover:border-theme-accent text-[11px] cursor-pointer flex-shrink-0">
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span className="font-mono">{copied ? 'Copied' : selected.commit.short_id}</span>
                </button>
              </div>
            )}
            <div className="flex-1 min-h-0">
              {sides && (
                <GitFileHistoryDiff cwd={cwd} before={sides.before} after={sides.after}
                  filePath={filePath} collapseUnchanged={!fullFile} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(content, document.body) : null
}
