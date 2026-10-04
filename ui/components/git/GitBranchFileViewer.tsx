import { useEffect, useState } from 'react'
import { Loader2, LockKeyhole } from 'lucide-react'

import { createGitAPI } from '../../gitAPI'
import { DiffEditor } from '../editor/DiffEditor'
import { EditorSurface } from '../editor/EditorSurface'
import type { GitFileChange } from './gitTypes'
import './git-diff.css'

const ignoreDirty = () => undefined

interface GitBranchFileViewerProps {
  cwd: string
  base: string
  target: string
  files: GitFileChange[]
}

export function GitBranchFileViewer({ cwd, base, target, files }: GitBranchFileViewerProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<{ original: string; modified: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const path = files.some((file) => file.path === selected) ? selected : files[0]?.path

  useEffect(() => {
    if (!path) return
    let active = true
    setContent(null)
    setError(null)
    const api = createGitAPI()
    const file = files.find((entry) => entry.path === path)
    const status = file?.staged !== 'unmodified' ? file?.staged : file?.unstaged
    // Added/deleted sides have no blob; all other failures remain visible in the viewer.
    const original = status === 'added' ? Promise.resolve('') : api.readFileRevision(cwd, file?.orig_path ?? path, base)
    const modified = status === 'deleted' ? Promise.resolve('') : api.readFileRevision(cwd, path, target)
    void Promise.all([original, modified]).then(([a, b]) => {
      if (active) setContent({ original: a, modified: b })
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [cwd, base, target, path, files])

  if (files.length === 0) return <div className="git-maintenance-empty">
    <LockKeyhole />
    <strong>No file differences</strong>
    <p>These branch snapshots contain the same files.</p>
  </div>
  return (
    <div className="git-branch-file-viewer">
      <div className="git-branch-file-picker">
        <label htmlFor="git-cleanup-file">File comparison</label>
        <select
          id="git-cleanup-file"
          value={path ?? ''}
          onChange={(event) => setSelected(event.target.value)}
        >{files.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}</select>
      </div>
      <div className="git-diff-columns">
        <div className="git-diff-column is-base">
          <strong>
            <LockKeyhole />
            {base}
          </strong>
          <span>Read-only</span>
        </div>
        <div className="git-diff-column">
          <strong>
            <LockKeyhole />
            {target}
          </strong>
          <span>Read-only</span>
        </div>
      </div>
      <EditorSurface label="Branch comparison · read-only">
        {error ? <div className="git-maintenance-empty" role="alert">{error}</div> : content && path ? <DiffEditor
          original={content.original}
          modified={content.modified}
          filePath={path}
          collapseUnchanged
          readOnly
          onDirtyChange={ignoreDirty}
        /> : <div className="git-maintenance-empty" role="status"><Loader2 className="animate-spin" />Loading comparison…</div>}
      </EditorSurface>
    </div>
  )
}
