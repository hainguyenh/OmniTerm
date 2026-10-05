import { FileLock2, Loader2, Play } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import type { WorkspaceScript } from '@omniterm/contract'

import { fileKindMeta } from '../../utils/fileKind'
import { CodeEditor } from './CodeEditor'
import { previewKindFor, RUNNABLE_KINDS } from './editorFileKinds'
import { EditorGitDialogs } from './EditorGitDialogs'
import { editorGitActions, type EditorGitDialog } from './editorGitActions'
import { FileEditorBanners } from './FileEditorBanners'
import { FileEditorHeader, type EditorMode } from './FileEditorHeader'
import { FileEditorStatusBar } from './FileEditorStatusBar'
import { profileNotice } from './fileProfile'
import { PreviewPane } from './PreviewPane'
import { useGitFileContext } from './useGitFileContext'
import { useTextDocument } from './useTextDocument'
import './editor.css'
import './editor-chrome.css'

export interface FileEditorTabProps {
  tabId: string
  workspaceId: string
  script: WorkspaceScript
  /** The tab is on screen. Hidden tabs keep their document but drop the editor view. */
  visible: boolean
  onClose: () => void
  onRun: () => void
  /** Reports unsaved-changes state upward so the owning tab can guard its close. */
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * A workspace file in a tab: edited in place (no view/edit toggle), with a rendered preview beside or
 * instead of the code for Markdown, CSV, HTML, JSON and SVG.
 *
 * Anything the scan marked `viewable` opens editable; the backend re-applies the same gate on every
 * read and save, and a file can still turn out unreadable once opened (binary content behind a text
 * extension, or larger than the configured cap) — that arrives as the load error in the body.
 */
export function FileEditorTab({ tabId, workspaceId, script, visible, onClose, onRun, onDirtyChange }: FileEditorTabProps) {
  const viewable = script.viewable ?? !!script.editable
  const doc = useTextDocument({ tabId, workspaceId, path: script.path, fileName: script.name, visible: visible && viewable })
  const previewKind = previewKindFor(script.name)
  const [mode, setMode] = useState<EditorMode>('code')
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null)
  const [noticeDismissed, setNoticeDismissed] = useState(false)
  const runnable = RUNNABLE_KINDS.has(script.kind)
  const runLabel = runnable ? (script.kind === 'rdp' ? 'Launch' : 'Run') : null
  const ready = doc.status === 'ready'
  const editable = ready && !doc.meta?.readOnly
  const gitContext = useGitFileContext(workspaceId, script.path, visible && ready)
  const [gitDialog, setGitDialog] = useState<EditorGitDialog | null>(null)
  const gitActions = useMemo(() => (gitContext ? editorGitActions(gitContext, setGitDialog) : undefined), [gitContext])

  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange
  useEffect(() => { onDirtyChangeRef.current?.(doc.dirty) }, [doc.dirty])

  const { save } = doc
  // Saving first means the run uses what is on screen, not the stale copy on disk.
  const run = useCallback(async () => {
    if (doc.dirty && (await save()) !== 'saved') return
    onRun()
  }, [doc.dirty, save, onRun])

  // Scoped to this tab's own DOM, so Ctrl+S never reaches a terminal or another editor.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (editable) void save()
    }
  }

  const onPreviewFallback = useCallback((reason: string) => {
    setMode('code')
    setFallbackNotice(reason)
  }, [])

  // A jump requested from the preview (JSON "Go to error") needs a code view; in preview-only mode
  // there is none until the split view mounts one, so the jump waits for it.
  const pendingReveal = useRef<number | null>(null)
  const { reveal } = doc
  const revealInCode = useCallback((offset: number) => {
    if (mode === 'preview') {
      pendingReveal.current = offset
      setMode('split')
    } else {
      reveal(offset)
    }
  }, [mode, reveal])
  const onViewReady = useCallback(() => {
    if (pendingReveal.current === null) return
    const offset = pendingReveal.current
    pendingReveal.current = null
    reveal(offset)
  }, [reveal])

  const profile = doc.meta?.profile ?? 'full'
  const notice = fallbackNotice ?? (noticeDismissed ? null : profileNotice(profile))
  const showCode = mode !== 'preview' || !previewKind
  const showPreview = !!previewKind && mode !== 'code'
  const { dirty, reload } = doc
  const onGitDiffClosed = useCallback(() => { if (!dirty) void reload() }, [dirty, reload])

  return (
    <>
      <div className="file-editor" onKeyDown={onKeyDown}>
        <FileEditorHeader
          script={script}
          dirty={doc.dirty}
          saving={doc.saving}
          canSave={editable}
          runLabel={runLabel}
          hasPreview={!!previewKind && ready}
          mode={mode}
          onModeChange={(next) => { setMode(next); setFallbackNotice(null) }}
          onRun={() => void run()}
          onSave={() => void save()}
          onClose={onClose}
        />
        <FileEditorBanners
          saveError={doc.saveError}
          conflict={doc.conflict}
          readOnly={!!doc.meta?.readOnly}
          notice={ready ? notice : null}
          onOverwrite={() => void save(true)}
          onReload={() => void doc.reload()}
          onDismissError={doc.dismissSaveError}
          onDismissNotice={() => { setFallbackNotice(null); setNoticeDismissed(true) }}
        />
        <div className="file-editor-body">
          {!viewable || doc.status === 'error' ? (
            <Unavailable script={script} reason={doc.loadError} runLabel={runLabel} onRun={onRun} />
          ) : !ready ? (
            <div className="flex items-center justify-center h-full text-[var(--theme-dim)]">
              <Loader2 className="w-5 h-5 animate-spin" aria-label="Loading" />
            </div>
          ) : (
            <>
              {showCode && (
                <div className={showPreview ? 'file-editor-split-pane' : 'file-editor-full-pane'}>
                  <CodeEditor model={doc.model} epoch={doc.epoch} visible={visible} onViewReady={onViewReady} actions={gitActions} />
                </div>
              )}
              {showPreview && previewKind && (
                <div className={showCode ? 'file-editor-split-pane file-editor-preview' : 'file-editor-full-pane file-editor-preview'}>
                  <PreviewPane kind={previewKind} doc={doc} visible={visible} fileName={script.name}
                    onFallback={onPreviewFallback} onReveal={revealInCode} />
                </div>
              )}
            </>
          )}
        </div>
        {ready && doc.meta && (
          <FileEditorStatusBar
            cursor={doc.cursor}
            languageId={doc.languageId}
            profile={profile}
            eol={doc.meta.eol}
            mixedEol={doc.meta.mixedEol}
            bom={doc.meta.bom}
            editable={editable}
            onEolChange={doc.setEol}
            onBomChange={doc.setBom}
          />
        )}
      </div>
      {gitContext && (
        <EditorGitDialogs context={gitContext} dialog={gitDialog} setDialog={setGitDialog} onDiffClosed={onGitDiffClosed} />
      )}
    </>
  )
}

function Unavailable({ script, reason, runLabel, onRun }: {
  script: WorkspaceScript
  reason: string | null
  runLabel: string | null
  onRun: () => void
}) {
  const meta = fileKindMeta(script.kind)
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
      <FileLock2 className="w-10 h-10" style={{ color: meta.color }} />
      <div className="text-sm text-[var(--theme-fg)]">Content not available to view</div>
      {/* The backend's own reason when it has one — it names the size limit and the setting that
          raises it, which a generic message could not. */}
      <div className="text-xs text-[var(--theme-dim)] max-w-sm">{reason ?? `${meta.label} files aren’t shown as text.`}</div>
      {runLabel && (
        <button
          type="button"
          onClick={onRun}
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-[var(--theme-border)] text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]"
        >
          <Play className="w-3.5 h-3.5" /> {runLabel}
        </button>
      )}
    </div>
  )
}
