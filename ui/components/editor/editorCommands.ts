import { undo, undoDepth } from '@codemirror/commands'
import { foldAll, foldCode, unfoldAll } from '@codemirror/language'
import { openSearchPanel } from '@codemirror/search'
import { Compartment, StateEffect, type EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/** The actions the editor surface's right-click panel offers. */
export type EditorCommandId = 'undo' | 'cut' | 'copy' | 'paste' | 'find' | 'fold' | 'foldAll' | 'unfoldAll' | 'wrap'

// Added on first toggle rather than in every extension set, so any CodeMirror view the surface
// wraps (file editor, diff, conflict result, branch viewer) can wrap without being built for it.
const wrapSlot = new Compartment()

export function isWrapping(state: EditorState): boolean {
  return wrapSlot.get(state) === EditorView.lineWrapping
}

function selectedText(state: EditorState): string {
  return state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => state.sliceDoc(range.from, range.to))
    .join(state.lineBreak)
}

export function isCommandEnabled(id: EditorCommandId, state: EditorState): boolean {
  const hasSelection = state.selection.ranges.some((range) => !range.empty)
  switch (id) {
    case 'undo': return !state.readOnly && undoDepth(state) > 0
    case 'cut': return !state.readOnly && hasSelection
    case 'copy': return hasSelection
    case 'paste': return !state.readOnly
    default: return true
  }
}

/** Runs one panel action against `view`, then hands focus back to the text. */
export async function runEditorCommand(id: EditorCommandId, view: EditorView): Promise<void> {
  switch (id) {
    case 'undo':
      undo(view)
      break
    case 'copy':
      await navigator.clipboard.writeText(selectedText(view.state))
      break
    case 'cut':
      await navigator.clipboard.writeText(selectedText(view.state))
      view.dispatch({ ...view.state.replaceSelection(''), userEvent: 'delete.cut', scrollIntoView: true })
      break
    case 'paste': {
      const text = await navigator.clipboard.readText()
      view.dispatch({ ...view.state.replaceSelection(text), userEvent: 'input.paste', scrollIntoView: true })
      break
    }
    case 'find':
      openSearchPanel(view)
      return
    case 'fold':
      foldCode(view)
      break
    case 'foldAll':
      foldAll(view)
      break
    case 'unfoldAll':
      unfoldAll(view)
      break
    case 'wrap': {
      const next = isWrapping(view.state) ? [] : EditorView.lineWrapping
      view.dispatch({
        effects: wrapSlot.get(view.state) === undefined
          ? StateEffect.appendConfig.of(wrapSlot.of(next))
          : wrapSlot.reconfigure(next),
      })
      break
    }
  }
  view.focus()
}

/**
 * The CodeMirror view an action should target: the editor under `target`, else the first editable
 * one inside `scope` (a merge view's working side rather than its read-only base), else any.
 */
export function findEditorView(target: EventTarget | null, scope: Element | null): EditorView | null {
  const hit = target instanceof Element ? target.closest('.cm-editor') : null
  const direct = hit instanceof HTMLElement ? EditorView.findFromDOM(hit) : null
  if (direct) return direct
  const views = Array.from(scope?.querySelectorAll<HTMLElement>('.cm-editor') ?? [])
    .map((element) => EditorView.findFromDOM(element))
    .filter((view): view is EditorView => view !== null)
  return views.find((view) => !view.state.readOnly) ?? views[0] ?? null
}
