import type { EditorState } from '@codemirror/state'
import { GitCommit, GitCompare, History, TextSelect } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'

import type { GitFileContext, GitLineRange } from '../git/gitTypes'
import type { EditorSurfaceActionGroup } from './EditorSurface'

/** The Git dialog an editor tab has open, if any. */
export type EditorGitDialog =
  | { type: 'history'; range?: GitLineRange }
  | { type: 'compare' }
  | { type: 'diff'; branch: string }
  | { type: 'blame' }

/**
 * 1-based lines covered by the main selection. A selection that ends at the very start of a line
 * (a whole-line selection made by dragging down) does not count that last, untouched line.
 */
export function selectionLineRange(state: EditorState): GitLineRange {
  const { from, to } = state.selection.main
  const start = state.doc.lineAt(from)
  const last = state.doc.lineAt(to)
  const end = to > from && last.from === to ? last.number - 1 : last.number
  return { start: start.number, end: Math.max(start.number, end) }
}

/** The right-click "Git" group for a file inside a repository. */
export function editorGitActions(
  context: GitFileContext,
  setDialog: Dispatch<SetStateAction<EditorGitDialog | null>>,
): EditorSurfaceActionGroup {
  return {
    heading: context.branch ? `Git · ${context.branch}` : 'Git',
    items: [
      { id: 'git-file-history', label: 'File history', Icon: History, onSelect: () => setDialog({ type: 'history' }) },
      {
        id: 'git-selection-history',
        label: 'History of selection',
        Icon: TextSelect,
        needsView: true,
        onSelect: (view) => { if (view) setDialog({ type: 'history', range: selectionLineRange(view.state) }) },
      },
      { id: 'git-compare-branch', label: 'Compare with branch…', Icon: GitCompare, onSelect: () => setDialog({ type: 'compare' }) },
      { id: 'git-blame', label: 'Annotate (blame)', Icon: GitCommit, onSelect: () => setDialog({ type: 'blame' }) },
    ],
  }
}
