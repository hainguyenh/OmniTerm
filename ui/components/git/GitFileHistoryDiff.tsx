import { useEffect, useState } from 'react'
import { History, Loader2 } from 'lucide-react'

import { createGitAPI } from '../../gitAPI'
import { DiffEditor } from '../editor/DiffEditor'
import { EditorSurface } from '../editor/EditorSurface'
import type { GitHistorySide } from './gitFileHistoryUtils'
import './git-diff.css'

interface GitFileHistoryDiffProps {
  cwd: string
  /** Both sides reload when their identity changes, so the host memoizes them. */
  before: GitHistorySide
  after: GitHistorySide
  /** Picks the grammar for both sides. */
  filePath: string
  collapseUnchanged: boolean
}

const ignoreDirty = () => undefined

function sideKey(side: GitHistorySide): string {
  return side.kind === 'empty' ? 'empty' : `${side.kind}:${side.kind === 'revision' ? side.revision : ''}:${side.path}`
}

/** A blob that is absent at its revision (added or deleted around it) reads as empty, not an error. */
function readSide(cwd: string, side: GitHistorySide): Promise<string> {
  const api = createGitAPI()
  if (side.kind === 'empty') return Promise.resolve('')
  if (side.kind === 'working') return api.readFile(cwd, side.path)
  return api.readFileRevision(cwd, side.path, side.revision).catch(() => '')
}

/** Read-only side-by-side diff of two versions of a file from its history. */
export function GitFileHistoryDiff({ cwd, before, after, filePath, collapseUnchanged }: GitFileHistoryDiffProps) {
  const key = `${sideKey(before)}|${sideKey(after)}`
  const [loaded, setLoaded] = useState<{ key: string; before: string; after: string } | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([readSide(cwd, before), readSide(cwd, after)]).then(
      ([beforeText, afterText]) => { if (active) setLoaded({ key, before: beforeText, after: afterText }) },
      (err: unknown) => { if (active) setError({ key, message: err instanceof Error ? err.message : String(err) }) },
    )
    return () => { active = false }
  }, [cwd, before, after, key])

  const current = loaded?.key === key ? loaded : null
  const failure = error?.key === key ? error.message : null

  return (
    <div className="flex flex-col h-full min-w-0 bg-theme-bg overflow-hidden text-xs font-mono">
      <div className="git-diff-columns">
        <div className="git-diff-column is-base"><strong><History />{before.label}</strong><span>Before</span></div>
        <div className="git-diff-column is-editable"><strong><History />{after.label}</strong><span>After</span></div>
      </div>
      <div className="flex-1 min-h-0 select-text">
        {failure ? (
          <div className="p-12 text-center text-theme-error">{failure}</div>
        ) : !current ? (
          <div className="flex items-center justify-center h-full gap-2 text-theme-dim">
            <Loader2 className="w-4 h-4 animate-spin text-theme-accent" />
            <span>Loading revision...</span>
          </div>
        ) : current.before === current.after ? (
          <div className="p-12 text-center text-theme-dim">No content changes between these versions.</div>
        ) : (
          <EditorSurface label="History diff · F7 next change">
            <DiffEditor
              original={current.before}
              modified={current.after}
              filePath={filePath}
              collapseUnchanged={collapseUnchanged}
              readOnly
              onDirtyChange={ignoreDirty}
            />
          </EditorSurface>
        )}
      </div>
    </div>
  )
}
