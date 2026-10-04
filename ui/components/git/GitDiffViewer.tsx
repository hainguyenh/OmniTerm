import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2 } from 'lucide-react'

import { createGitAPI } from '../../gitAPI'
import type { TextEditorHandle } from '../editor/diffEditorModel'
import './git-ui.css'
import './git-diff.css'
import { EditorSurface } from '../editor/EditorSurface'
import { GitDiffHeader } from './GitDiffHeader'
import { GitInlineDiffEditor } from './GitInlineDiffEditor'
import type { GitFileDiff } from './gitTypes'

interface GitDiffViewerProps {
  cwd: string
  filePath: string
  staged: boolean
  targetBranch?: string
  inline?: boolean
  allFiles?: Array<string | { path: string; staged: boolean }>
  onSelectFile?: (path: string, staged: boolean) => void
  onClose: () => void
}

export const GitDiffViewer: React.FC<GitDiffViewerProps> = ({
  cwd,
  filePath,
  staged,
  targetBranch,
  inline = false,
  allFiles = [],
  onSelectFile,
  onClose,
}) => {
  const [diff, setDiff] = useState<GitFileDiff | null>(null)
  const [localContent, setLocalContent] = useState('')
  const [serverContent, setServerContent] = useState('')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const editorRef = useRef<TextEditorHandle>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [staging, setStaging] = useState(false)
  const [viewMode, setViewMode] = useState<'diff' | 'full'>('diff')

  const normalizedFiles = useMemo(() => {
    return allFiles.map((f) => (typeof f === 'string' ? { path: f, staged } : f))
  }, [allFiles, staged])

  const currentIndex = useMemo(
    () => normalizedFiles.findIndex((f) => f.path === filePath),
    [normalizedFiles, filePath],
  )
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex >= 0 && currentIndex < normalizedFiles.length - 1

  const handlePrev = () => {
    if (hasPrev && onSelectFile) {
      const prev = normalizedFiles[currentIndex - 1]
      onSelectFile(prev.path, prev.staged)
    }
  }

  const handleNext = () => {
    if (hasNext && onSelectFile) {
      const next = normalizedFiles[currentIndex + 1]
      onSelectFile(next.path, next.staged)
    }
  }

  const loadData = useCallback(() => {
    let active = true
    setLoading(true)
    setError(null)
    const api = createGitAPI()

    const diffPromise = targetBranch
      ? api.getDiffBranch(cwd, filePath, targetBranch)
      : api.getDiff(cwd, filePath, staged)

    const filePromise = typeof api.readFile === 'function'
      ? api.readFile(cwd, filePath).catch(() => '')
      : Promise.resolve('')
    const serverRev = targetBranch ?? (staged ? 'HEAD' : ':0')
    const serverPromise = typeof api.readFileRevision === 'function'
      ? api
        .readFileRevision(cwd, filePath, serverRev)
        .catch(() => api.readFileRevision(cwd, filePath, 'HEAD').catch(() => ''))
      : Promise.resolve('')

    void Promise.all([diffPromise, filePromise, serverPromise])
      .then(([diffRes, fileRes, serverRes]) => {
        if (active) {
          setDiff(diffRes)
          setLocalContent(fileRes ?? '')
          setServerContent(serverRes ?? '')
          setHasUnsavedChanges(false)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (active) {
          const msg = err instanceof Error ? err.message : String(err)
          setError(msg)
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [cwd, filePath, staged, targetBranch])

  useEffect(() => {
    return loadData()
  }, [loadData])

  const handleSave = async () => {
    const editor = editorRef.current
    if (saving || !hasUnsavedChanges || !editor) return
    setSaving(true)
    setSaveNotice(null)
    const api = createGitAPI()
    try {
      await api.writeFile(cwd, filePath, editor.getText())
      editor.markSaved()
      setSaveNotice('Saved successfully')
      window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
      setTimeout(() => setSaveNotice(null), 3000)
    } catch (err: unknown) {
      setSaveNotice(`Save failed: ${String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const keyActions = useRef({ handleSave, handlePrev, handleNext, onClose, hasUnsavedChanges })
  keyActions.current = { handleSave, handlePrev, handleNext, onClose, hasUnsavedChanges }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const actions = keyActions.current
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void actions.handleSave()
        return
      }
      // The editor already handled it: Escape closing its search panel, Ctrl+Arrow moving by word.
      if (e.defaultPrevented) return
      if (e.key === 'Escape') {
        if (!actions.hasUnsavedChanges) actions.onClose()
      } else if (e.key === 'ArrowLeft' && (e.altKey || e.ctrlKey)) {
        e.preventDefault()
        actions.handlePrev()
      } else if (e.key === 'ArrowRight' && (e.altKey || e.ctrlKey)) {
        e.preventDefault()
        actions.handleNext()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleToggleStage = async () => {
    if (staging) return
    setStaging(true)
    const api = createGitAPI()
    try {
      if (staged) {
        await api.unstage(cwd, [filePath])
        onSelectFile?.(filePath, false)
      } else {
        await api.stage(cwd, [filePath])
        onSelectFile?.(filePath, true)
      }
      window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
    } catch {
      // staging failed
    } finally {
      setStaging(false)
    }
  }

  const { totalAdditions, totalDeletions } = useMemo(() => {
    let additions = 0
    let deletions = 0
    for (const hunk of diff?.hunks ?? []) {
      for (const line of hunk.lines) {
        if (line.line_type === 'addition') additions += 1
        else if (line.line_type === 'deletion') deletions += 1
      }
    }
    return { totalAdditions: additions, totalDeletions: deletions }
  }, [diff])

  const innerContent = (
    <div className={`w-full h-full bg-theme-bg flex flex-col overflow-hidden ${inline ? '' : 'max-w-6xl border border-theme-border rounded-xl shadow-2xl animate-in zoom-in-95 duration-150'}`}>
      <GitDiffHeader
        filePath={filePath} staged={staged} targetBranch={targetBranch}
        additions={totalAdditions} deletions={totalDeletions}
        dirty={hasUnsavedChanges} saving={saving} staging={staging} notice={saveNotice}
        viewMode={viewMode} index={currentIndex} count={normalizedFiles.length}
        hasPrev={hasPrev} hasNext={hasNext}
        onPrev={handlePrev} onNext={handleNext} onSave={() => void handleSave()}
        onStage={() => void handleToggleStage()} onClose={onClose}
        onSelectVersion={(next) => onSelectFile?.(filePath, next)} onViewMode={setViewMode}
      />

      {/* ── Inline Diff / Conflict Editor Body ───────────────────────────── */}
      <div className="flex-1 overflow-hidden font-mono text-xs select-text bg-theme-bg">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-theme-dim gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-theme-accent" />
            <span>Loading file diff...</span>
          </div>
        ) : error ? (
          <div className="p-12 text-center text-theme-error">{error}</div>
        ) : diff?.is_binary ? (
          <div className="p-12 text-center text-theme-dim">
            Binary file diff not shown
          </div>
        ) : (
          <EditorSurface label="Diff editor · F7 next change">
            <GitInlineDiffEditor
              ref={editorRef}
              localContent={localContent}
              serverContent={serverContent}
              filePath={filePath}
              viewMode={viewMode}
              baseLabel={targetBranch ?? (staged ? 'HEAD' : 'Index · staged version')}
              onDirtyChange={setHasUnsavedChanges}
            />
          </EditorSurface>
        )}
      </div>
    </div>
  )

  if (inline) {
    return innerContent
  }

  const modalContent = (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-6 bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !hasUnsavedChanges) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Diff for ${filePath}`}
    >
      {innerContent}
    </div>
  )

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : null
}
