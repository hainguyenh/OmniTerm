import { EditorView } from '@codemirror/view'
import { useLayoutEffect, useRef } from 'react'

import type { DocumentModel } from './documentModel'
import { EditorSurface, type EditorSurfaceActionGroup } from './EditorSurface'

interface CodeEditorProps {
  model: DocumentModel
  /** Changes whenever the model's state is replaced, so the view is rebuilt around the new one. */
  epoch: number
  visible: boolean
  /** Called each time a view has been created, e.g. to apply a cursor move requested while none existed. */
  onViewReady?: () => void
  /** Extra right-click actions, e.g. Git commands for a file inside a repository. */
  actions?: EditorSurfaceActionGroup
}

/**
 * The CodeMirror view for one tab — mounted only while the tab is visible.
 *
 * MainLayout keeps every tab mounted (hidden ones are moved off-screen), so without this a workspace
 * with thirty open files would carry thirty live editors and their DOM. Instead the view is destroyed
 * on hide, after saving its scroll position and focus into the model, and rebuilt on show; the
 * document, undo history and selection survive in the model's `EditorState`.
 */
export function CodeEditor({ model, epoch, visible, onViewReady, actions }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const onViewReadyRef = useRef(onViewReady)
  onViewReadyRef.current = onViewReady

  useLayoutEffect(() => {
    const host = hostRef.current
    const state = model.state
    if (!visible || !host || !state) return
    const generation = model.generation
    const head = state.selection.main.head
    const view = new EditorView({
      state,
      parent: host,
      scrollTo: model.scroll ?? (head > 0 ? EditorView.scrollIntoView(head, { y: 'center' }) : undefined),
    })
    model.view = view
    if (model.hadFocus) view.focus()
    onViewReadyRef.current?.()
    return () => {
      // A reload or eviction bumps the generation: this view's state is then the discarded document
      // and must not be written back over the new one.
      if (model.generation === generation) {
        model.state = view.state
        model.scroll = view.scrollSnapshot()
        model.hadFocus = view.hasFocus
      }
      if (model.view === view) model.view = null
      view.destroy()
    }
  }, [model, epoch, visible])

  return (
    <EditorSurface label="Code editor" actions={actions}>
      <div ref={hostRef} className="file-editor-code" />
    </EditorSurface>
  )
}
