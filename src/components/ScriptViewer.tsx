import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pencil, Eye, Save, X, Loader2, AlertTriangle, FileLock2 } from 'lucide-react'
import type { WorkspaceScript } from '@omniterm/contract'
import { fileKindMeta } from '../utils/fileKind'
import { highlightLines, type Token, type TokenType } from '../utils/scriptHighlight'

/**
 * A light, docked viewer/editor for a workspace item. Fills its container (the right-side dock in
 * MainLayout) rather than floating as a modal. Dependency-free: a tiny tokenizer colors both the
 * read view and the editor (a transparent textarea over a synced highlighted <pre>) — no Monaco.
 *
 * Editable executable scripts open read-only (default) with syntax coloring; the pencil flips to a
 * colored edit mode and Ctrl+S saves. Non-editable items (.rdp) can still be opened, but show a
 * "content not available" placeholder with a launch action instead of file contents.
 */
interface ScriptViewerProps {
  workspaceId: string
  script: WorkspaceScript
  onClose: () => void
  onRun: () => void
  /** Reports unsaved-changes state upward so the owning tab can guard its close. */
  onDirtyChange?: (dirty: boolean) => void
}

/** Token colors — stable across themes so scripts stay legible in both view and edit. */
const TOKEN_COLOR: Record<TokenType, string | undefined> = {
  comment: '#6a9955',
  string: '#ce9178',
  keyword: '#569cd6',
  variable: '#9cdcfe',
  number: '#b5cea8',
  text: undefined,
}

/** Shared box model for the view + edit code surfaces so the highlight overlay lines up 1:1. */
const CODE_CLS = 'm-0 p-4 font-mono text-[13px] leading-relaxed whitespace-pre'

/** Render tokenized lines as colored spans separated by real newlines (matches a textarea 1:1). */
function renderCode(lines: Token[][]): React.ReactNode {
  return lines.map((tokens, i) => (
    <React.Fragment key={i}>
      {tokens.map((t, j) => (
        <span
          key={j}
          style={t.type === 'comment'
            ? { color: TOKEN_COLOR.comment, fontStyle: 'italic' }
            : { color: TOKEN_COLOR[t.type] }}
        >
          {t.text}
        </span>
      ))}
      {i < lines.length - 1 ? '\n' : null}
    </React.Fragment>
  ))
}

const ScriptViewer: React.FC<ScriptViewerProps> = ({ workspaceId, script, onClose, onRun, onDirtyChange }) => {
  const meta = fileKindMeta(script.kind)
  const editable = !!script.editable

  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [loading, setLoading] = useState(editable)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)

  const dirty = content !== original
  const runLabel = script.kind === 'rdp' ? 'Launch' : 'Run'

  // Report unsaved-changes state to the owning tab (via a ref so we only fire on change).
  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange
  useEffect(() => { onDirtyChangeRef.current?.(dirty) }, [dirty])

  // Keep the highlighted overlay aligned with the textarea as the user scrolls.
  const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (!preRef.current) return
    preRef.current.scrollTop = e.currentTarget.scrollTop
    preRef.current.scrollLeft = e.currentTarget.scrollLeft
  }

  // Opening a different file always starts in read mode (edit is opt-in, per file).
  useEffect(() => { setMode('view') }, [script.path])

  useEffect(() => {
    if (!editable) return
    let cancelled = false
    setLoading(true)
    window.omnitermAPI.workspace.readScript(workspaceId, script.path)
      .then((text) => { if (!cancelled) { setContent(text); setOriginal(text) } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [editable, workspaceId, script.path])

  const save = useCallback(async () => {
    if (!dirty || saving) return
    setSaving(true)
    setError(null)
    try {
      await window.omnitermAPI.workspace.writeScript(workspaceId, script.path, content)
      setOriginal(content)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [dirty, saving, workspaceId, script.path, content])

  // Ctrl/Cmd+S saves while editing.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (mode === 'edit') void save()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [mode, save])

  const requestClose = () => (dirty ? setConfirmDiscard(true) : onClose())
  const enterEdit = () => { setMode('edit'); setTimeout(() => textareaRef.current?.focus(), 0) }

  const lines = useMemo(() => highlightLines(content, script.kind), [content, script.kind])
  const Icon = meta.icon

  return (
    <div className="flex flex-col h-full w-full min-w-0" style={{ backgroundColor: 'var(--theme-bg)' }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0"
        style={{ backgroundColor: 'var(--theme-sidebar-bg)', borderColor: 'var(--theme-border)' }}
      >
        <Icon className="w-4 h-4 flex-shrink-0" style={{ color: meta.color }} />
        <span className="text-sm font-medium text-[var(--theme-fg)] truncate">{script.name}</span>
        {dirty && <span className="text-[var(--theme-accent)] text-xs flex-shrink-0" title="Unsaved changes">●</span>}
        <span className="flex-1 truncate text-xs text-[var(--theme-dim)] text-right" title={script.path}>
          {script.path}
        </span>

        <div className="flex items-center gap-1 flex-shrink-0 ml-1">
          <HeaderBtn title={runLabel} onClick={onRun}><Play className="w-4 h-4" /></HeaderBtn>
          {editable && (mode === 'view'
            ? <HeaderBtn title="Edit" onClick={enterEdit}><Pencil className="w-4 h-4" /></HeaderBtn>
            : <HeaderBtn title="View" onClick={() => setMode('view')}><Eye className="w-4 h-4" /></HeaderBtn>)}
          {editable && mode === 'edit' && (
            <HeaderBtn title="Save (Ctrl+S)" onClick={() => void save()} disabled={!dirty || saving} accent>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            </HeaderBtn>
          )}
          <HeaderBtn title="Close" onClick={requestClose}><X className="w-4 h-4" /></HeaderBtn>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs bg-red-500/10 text-red-400 border-b border-[var(--theme-border)]">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {!editable ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <FileLock2 className="w-10 h-10" style={{ color: meta.color }} />
            <div className="text-sm text-[var(--theme-fg)]">Content not available to view</div>
            <div className="text-xs text-[var(--theme-dim)] max-w-xs">
              {meta.label} files aren’t readable as text. Use {runLabel} to open it.
            </div>
            <button
              type="button"
              onClick={onRun}
              className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-[var(--theme-border)] text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
            >
              <Play className="w-3.5 h-3.5" /> {runLabel}
            </button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full text-[var(--theme-dim)]">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : mode === 'edit' ? (
          // Colorful editing: a transparent textarea over a synced, highlighted <pre>.
          <div className="relative w-full h-full overflow-hidden">
            <pre
              ref={preRef}
              aria-hidden
              className={`absolute inset-0 overflow-hidden pointer-events-none text-[var(--theme-fg)] ${CODE_CLS}`}
            >
              {renderCode(lines)}
            </pre>
            <textarea
              ref={textareaRef}
              value={content}
              spellCheck={false}
              wrap="off"
              onChange={(e) => setContent(e.target.value)}
              onScroll={syncScroll}
              className={`code-editor-textarea absolute inset-0 w-full h-full overflow-auto resize-none outline-none bg-transparent ${CODE_CLS}`}
              style={{ color: 'transparent', caretColor: 'var(--theme-fg)' }}
            />
          </div>
        ) : (
          <pre className={`w-full h-full overflow-auto text-[var(--theme-fg)] ${CODE_CLS}`}>
            {renderCode(lines)}
          </pre>
        )}
      </div>

      {/* Discard-changes confirm */}
      {confirmDiscard && (
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-[var(--theme-border)] bg-[var(--theme-sidebar-bg)] text-xs">
          <span className="mr-auto text-[var(--theme-dim)]">Discard unsaved changes?</span>
          <button
            type="button"
            onClick={() => setConfirmDiscard(false)}
            className="px-2.5 py-1 rounded border border-[var(--theme-border)] text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={() => { setConfirmDiscard(false); onClose() }}
            className="px-2.5 py-1 rounded bg-red-500/80 text-white hover:bg-red-500"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  )
}

const HeaderBtn: React.FC<{
  title: string
  onClick: () => void
  disabled?: boolean
  accent?: boolean
  children: React.ReactNode
}> = ({ title, onClick, disabled, accent, children }) => (
  <button
    type="button"
    title={title}
    disabled={disabled}
    onClick={onClick}
    className={`p-1.5 rounded transition-colors ${
      disabled
        ? 'text-[var(--theme-dim)] opacity-40 cursor-not-allowed'
        : accent
          ? 'text-[var(--theme-accent)] hover:bg-[var(--theme-hover-bg)]'
          : 'text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]'
    }`}
  >
    {children}
  </button>
)

export default ScriptViewer
