import { useCallback, useEffect } from 'react'

import { diag } from '../diag'
import { editorService } from '../ide/workbench/contributions'

/** Note ids come from window events: only plain ids are opened. */
const NOTE_ID = /^[A-Za-z0-9_-]{1,100}$/

/** Opens a temporary note as an editor tab of the `notes` kind (one tab per note). */
export function openNoteTab(noteId: string, title?: string): void {
  if (!NOTE_ID.test(noteId)) return
  editorService()
    .openInput({ kind: 'notes', key: `notes:${noteId}`, data: { noteId, title: title || 'Sticky Note' } }, { focus: true })
    .catch((error: unknown) => diag.warn('[notes] could not open the note', error))
}

export function useTempNotes() {
  const openTempTab = useCallback((noteId: string, title?: string) => openNoteTab(noteId, title), [])

  useEffect(() => {
    const handleNewTempNote = () => {
      const noteId = `note-${Date.now()}`
      void window.omnitermAPI.tempNotes.write(noteId, '').then(() => {
        window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
        openNoteTab(noteId, 'Untitled')
      })
    }

    const handleOpenTempTab = (e: Event) => {
      const custom = e as CustomEvent<{ id: string; title?: string; content?: string }>
      if (custom.detail?.id) {
        const preview = custom.detail.title || custom.detail.content?.split('\n').find((l) => l.trim().length > 0)?.trim()
        openNoteTab(custom.detail.id, preview || 'Sticky Note')
      }
    }

    window.addEventListener('omniterm:new-temp-note', handleNewTempNote)
    window.addEventListener('omniterm:open-temp-tab', handleOpenTempTab)

    return () => {
      window.removeEventListener('omniterm:new-temp-note', handleNewTempNote)
      window.removeEventListener('omniterm:open-temp-tab', handleOpenTempTab)
    }
  }, [])

  return { openTempTab }
}
