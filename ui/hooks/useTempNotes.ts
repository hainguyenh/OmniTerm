import { useCallback, useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { WorkspaceScript } from '@omniterm/contract'

interface UseTempNotesParams {
  activeTabs: { id: string; connId: string; name: string }[]
  setActiveTabs: Dispatch<SetStateAction<{ id: string; connId: string; name: string }[]>>
  setEditorTabs: Dispatch<SetStateAction<Record<string, { workspaceId: string; script: WorkspaceScript }>>>
  showTab: (id: string, opts?: { autoFillOnly?: boolean; newTab?: boolean }) => void
}

export function useTempNotes({
  setActiveTabs,
  setEditorTabs,
  showTab,
}: UseTempNotesParams) {
  const openTempTab = useCallback((noteId: string, title?: string) => {
    const tabId = `temp:${noteId}`
    const displayTitle = title || 'Sticky Note'
    const script: WorkspaceScript = {
      id: noteId,
      name: displayTitle,
      path: `temp://${noteId}`,
      kind: 'txt',
      editable: true,
      viewable: true,
    }
    setEditorTabs((prev) => ({ ...prev, [tabId]: { workspaceId: '__temp__', script } }))
    setActiveTabs((prev) => (prev.some((t) => t.id === tabId) ? prev : [...prev, { id: tabId, connId: tabId, name: displayTitle }]))
    showTab(tabId, { autoFillOnly: true, newTab: true })
  }, [setEditorTabs, setActiveTabs, showTab])

  useEffect(() => {
    const handleNewTempNote = () => {
      const noteId = `note-${Date.now()}`
      void window.omnitermAPI.tempNotes.write(noteId, '').then(() => {
        window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
        openTempTab(noteId, 'Untitled')
      })
    }

    const handleOpenTempTab = (e: Event) => {
      const custom = e as CustomEvent<{ id: string; title?: string; content?: string }>
      if (custom.detail?.id) {
        const preview = custom.detail.title || custom.detail.content?.split('\n').find((l) => l.trim().length > 0)?.trim()
        openTempTab(custom.detail.id, preview || 'Sticky Note')
      }
    }

    window.addEventListener('omniterm:new-temp-note', handleNewTempNote)
    window.addEventListener('omniterm:open-temp-tab', handleOpenTempTab)

    return () => {
      window.removeEventListener('omniterm:new-temp-note', handleNewTempNote)
      window.removeEventListener('omniterm:open-temp-tab', handleOpenTempTab)
    }
  }, [openTempTab])

  return { openTempTab }
}
