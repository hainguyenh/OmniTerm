import { TempNoteEditorTab } from '../../components/editor/TempNoteEditorTab'
import { editorService, useEditorShown, type EditorInput } from '../../ide/workbench/contributions'

export function NotesEditorKind({ input }: { input: EditorInput }) {
  const shown = useEditorShown()
  const data = input.data as { noteId?: string } | undefined
  const noteId = data?.noteId ?? input.key.replace(/^notes:/, '')

  return (
    <TempNoteEditorTab
      noteId={noteId}
      tabId={input.key}
      visible={shown}
      onClose={() => {
        void editorService().closeInput?.(input.key)
      }}
    />
  )
}
