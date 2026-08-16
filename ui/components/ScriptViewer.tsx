import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Play, Copy, X, Check, Eye, Pencil, Save, AlertTriangle, Loader2, Code2, BookOpen, FileLock2,
} from 'lucide-react'
import type { WorkspaceScript } from '@omniterm/contract'
import { fileKindMeta } from '../utils/fileKind'
import { Tooltip } from './Tooltip'
import { highlightLines, type Token, type TokenType } from '../utils/scriptHighlight'
import MarkdownPreview from './MarkdownPreview'

/**
 * A light, docked viewer/editor for a workspace item. Fills its container (the right-side dock in
 * MainLayout) rather than floating as a modal. Dependency-free: a tiny tokenizer colors both the
 * read view and the editor (a transparent textarea over a synced highlighted <pre>) — no Monaco.
 *
 * **Viewing and editing are separate rights.** Anything the scan marked `viewable` — any text file,
 * not just a script — opens read-only with syntax coloring. `editable` is the narrower one: only an
 * executable script gets the pencil, the colored edit mode and Ctrl+S. A file that is neither (an
 * `.exe`, an archive, a `.pem`) keeps the "content not available" placeholder with a launch action.
 *
 * The backend is the authority on both, and it re-checks on every read and write — a file can also
 * turn out to be unreadable only once opened (binary content behind a text extension, or larger than
 * the configured size cap), which arrives as an error in the banner rather than as a flag.
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

/**
 * Kinds the host will actually launch — the renderer half of `LAUNCHABLE_EXTS` in safepath.rs.
 *
 * Needed once the viewer started opening *every* text file: a `Run` button on a `notes.txt` offers an
 * action the backend refuses with "only scanned scripts can be run", so the button is hidden rather
 * than left to fail. `.cmd` is absent because the scan reports it as kind `bat`.
 */
const RUNNABLE_KINDS = new Set(['bat', 'ps1', 'sh', 'rdp'])

/** Kinds `MarkdownPreview` knows how to render — real Markdown syntax, not the wider "Markdown" family
 *  `fileKindMeta` groups for icon purposes (which also covers `.rst`/`.adoc`, different syntaxes). */
const MARKDOWN_KINDS = new Set(['md', 'markdown', 'mdx'])

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
  // An editable file is always viewable; `?? editable` keeps a provider that predates `viewable`
  // working exactly as it did rather than showing the placeholder for its scripts.
  const viewable = script.viewable ?? editable

  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [mode, setMode] = useState<'view' | 'edit' | 'preview'>('view')
  const isMarkdown = MARKDOWN_KINDS.has(script.kind)
  const [loading, setLoading] = useState(viewable)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Kept apart from `error`: a failed *read* means there is no content to show, so it belongs in the
  // body where the file would have been. A failed *save* leaves the user's text on screen and must not
  // replace it, so it stays in the banner above.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [pathCopied, setPathCopied] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)

  const dirty = content !== original
  const runnable = RUNNABLE_KINDS.has(script.kind)
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
    if (!viewable) return
    let cancelled = false
    setLoading(true)
    // Clear the previous file's state up front: switching tabs must not leave the old error, or the
    // old text, on screen while the new file loads.
    setLoadError(null)
    setError(null)
    setContent('')
    setOriginal('')
    window.omnitermAPI.workspace.readScript(workspaceId, script.path)
      .then((text) => { if (!cancelled) { setContent(text); setOriginal(text) } })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [viewable, workspaceId, script.path])

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

  // Ctrl/Cmd+S saves while editing. Document-wide, so without the terminal-focus guard it stole
  // Ctrl+S from a focused terminal pane any time an editor tab happened to be open elsewhere.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement
      if (active instanceof Element && active.closest('.xterm')) return
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
  const onPreviewFallback = useCallback(() => {
    setMode('view')
    setError('Preview took too long to render (likely an invalid diagram) — showing the raw file instead.')
  }, [])
  const copyPath = useCallback(() => {
    void navigator.clipboard.writeText(script.path).then(() => {
      setPathCopied(true)
      setTimeout(() => setPathCopied(false), 1500)
    })
  }, [script.path])

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
          {runnable && <HeaderBtn title={runLabel} onClick={onRun}><Play className="w-4 h-4" /></HeaderBtn>}
          {isMarkdown && !loadError && (mode === 'preview'
            ? <HeaderBtn title="View raw" onClick={() => setMode('view')}><Code2 className="w-4 h-4" /></HeaderBtn>
            : <HeaderBtn title="Preview" onClick={() => setMode('preview')}><BookOpen className="w-4 h-4" /></HeaderBtn>)}
          <HeaderBtn title={pathCopied ? 'Copied!' : 'Copy path'} onClick={copyPath} accent={pathCopied}>
            {pathCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </HeaderBtn>
          {/* Edit is offered only for a script whose text actually loaded — there is nothing to edit
              behind a read that failed on size or binary content. */}
          {editable && !loadError && (mode === 'view'
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
        {!viewable || loadError ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <FileLock2 className="w-10 h-10" style={{ color: meta.color }} />
            <div className="text-sm text-[var(--theme-fg)]">Content not available to view</div>
            <div className="text-xs text-[var(--theme-dim)] max-w-sm">
              {/* The backend's own reason when it has one — it names the size limit and the setting
                  that raises it, which a generic message could not. */}
              {loadError ?? `${meta.label} files aren’t shown as text.`}
            </div>
            {runnable && (
              <button
                type="button"
                onClick={onRun}
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-[var(--theme-border)] text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
              >
                <Play className="w-3.5 h-3.5" /> {runLabel}
              </button>
            )}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full text-[var(--theme-dim)]">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : mode === 'preview' ? (
          <MarkdownPreview content={content} onFallback={onPreviewFallback} />
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
  <Tooltip content={title} placement="bottom">
    <button
      type="button"
      aria-label={title}
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
  </Tooltip>
)

export default ScriptViewer
