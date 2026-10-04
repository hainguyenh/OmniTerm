import { BookOpen, Check, ChevronRight, Code2, Columns2, Copy, Ellipsis, Loader2, Play, Save, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import type { WorkspaceScript } from '@omniterm/contract'

import { FileTypeIcon } from '../FileTypeIcon'
import { Tooltip } from '../Tooltip'

export type EditorMode = 'code' | 'split' | 'preview'

interface FileEditorHeaderProps {
  script: WorkspaceScript
  dirty: boolean
  saving: boolean
  canSave: boolean
  runLabel: string | null
  hasPreview: boolean
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
  onRun: () => void
  onSave: () => void
  onClose: () => void
}

const MODES: { mode: EditorMode; title: string; icon: typeof Code2 }[] = [
  { mode: 'code', title: 'Code', icon: Code2 },
  { mode: 'split', title: 'Split', icon: Columns2 },
  { mode: 'preview', title: 'Preview', icon: BookOpen },
]

/** A single breadcrumb toolbar below the shell's existing file tabs. */
export function FileEditorHeader({
  script, dirty, saving, canSave, runLabel, hasPreview, mode, onModeChange, onRun, onSave, onClose,
}: FileEditorHeaderProps) {
  const pathSegments = script.path.split(/[\\/]/).filter(Boolean)
  // Mounted folder IDs are routing keys, not meaningful directory names.
  if (pathSegments[0]?.startsWith('folder#')) pathSegments.shift()
  const displayPath = pathSegments.join(' / ')
  const [pathCopied, setPathCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current) }, [])

  const copyPath = useCallback(() => {
    void navigator.clipboard.writeText(script.path).then(() => {
      setPathCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setPathCopied(false), 1500)
    })
  }, [script.path])

  return (
    <div className="file-editor-header">
      <nav className="file-editor-breadcrumbs" aria-label="File path" title={displayPath}>
        {pathSegments.map((segment, index) => (
          <span key={index} className={index === pathSegments.length - 1 ? 'is-current' : undefined}>
            {index > 0 && <ChevronRight aria-hidden="true" />}
            {index === pathSegments.length - 1 && <FileTypeIcon name={script.name} kind={script.kind} />}
            <span>{segment}</span>
          </span>
        ))}
        {(dirty || saving) && (
          <span className="file-editor-dirty" role="status" aria-label={saving ? 'Saving' : 'Unsaved changes'}>
            {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : '●'}
          </span>
        )}
      </nav>

      <div className="file-editor-toolbar-actions">
        {hasPreview && (
          <div className="file-editor-modes" role="group" aria-label="View mode">
            {MODES.map(({ mode: value, title, icon: ModeIcon }) => (
              <Tooltip key={value} content={title} placement="bottom">
                <button
                  type="button"
                  aria-label={title}
                  aria-pressed={mode === value}
                  className={mode === value ? 'is-active' : undefined}
                  onClick={() => onModeChange(value)}
                >
                  <ModeIcon className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            ))}
          </div>
        )}

        {runLabel && <HeaderButton title={runLabel} onClick={onRun} accent><Play className="w-3.5 h-3.5" /></HeaderButton>}
        {canSave && (dirty || saving) && (
          <HeaderButton title="Save (Ctrl+S)" onClick={onSave} disabled={saving} accent>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          </HeaderButton>
        )}
        <details
          className="file-editor-more"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.currentTarget.open = false
              event.currentTarget.querySelector('summary')?.focus()
            }
          }}
        >
          <summary aria-label="File actions" title="File actions"><Ellipsis aria-hidden="true" /></summary>
          <div className="file-editor-more-menu" onClick={(event) => {
            const details = event.currentTarget.closest('details')
            if (details) details.open = false
          }}>
            <button type="button" onClick={copyPath}>
              {pathCopied ? <Check /> : <Copy />}<span>{pathCopied ? 'Copied!' : 'Copy path'}</span>
            </button>
            {canSave && <button type="button" onClick={onSave} disabled={!dirty || saving}>
              <Save /><span>Save</span><kbd>Ctrl+S</kbd>
            </button>}
            <div className="file-editor-more-divider" />
            <button type="button" onClick={onClose}><X /><span>Close file</span></button>
          </div>
        </details>
      </div>
    </div>
  )
}

function HeaderButton({ title, onClick, disabled, accent, children }: {
  title: string
  onClick: () => void
  disabled?: boolean
  accent?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip content={title} placement="bottom">
      <button type="button" aria-label={title} disabled={disabled} onClick={onClick} className={`file-editor-header-action${accent ? ' is-accent' : ''}`}>
        {children}
      </button>
    </Tooltip>
  )
}
