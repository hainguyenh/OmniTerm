import React, { useEffect, useState } from 'react'
import { StickyNoteWindow } from './StickyNoteWindow'

export const StickyNoteHost: React.FC = () => {
  const [openNoteIds, setOpenNoteIds] = useState<string[]>([])

  useEffect(() => {
    const handleOpen = (e: Event) => {
      const custom = e as CustomEvent<{ id: string }>
      if (custom.detail?.id) {
        setOpenNoteIds((prev) => (prev.includes(custom.detail.id) ? prev : [...prev, custom.detail.id]))
      }
    }

    const handleNew = () => {
      const id = `note-${Date.now()}`
      void window.omnitermAPI.tempNotes.write(id, '').then(() => {
        window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
        setOpenNoteIds((prev) => [...prev, id])
      })
    }

    window.addEventListener('omniterm:open-sticky-note', handleOpen)
    window.addEventListener('omniterm:new-sticky-note', handleNew)
    return () => {
      window.removeEventListener('omniterm:open-sticky-note', handleOpen)
      window.removeEventListener('omniterm:new-sticky-note', handleNew)
    }
  }, [])

  const handleClose = (id: string) => {
    setOpenNoteIds((prev) => prev.filter((item) => item !== id))
  }

  const handleOpenInTab = (id: string, content: string) => {
    handleClose(id)
    window.dispatchEvent(
      new CustomEvent('omniterm:open-temp-tab', {
        detail: { id, content },
      }),
    )
  }

  const handleDelete = (id: string) => {
    handleClose(id)
    void window.omnitermAPI.tempNotes.delete(id).then(() => {
      window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed'))
    })
  }

  return (
    <>
      {openNoteIds.map((id, index) => (
        <StickyNoteWindow
          key={id}
          id={id}
          initialPosition={{ x: 120 + (index % 5) * 30, y: 100 + (index % 5) * 30 }}
          onClose={() => handleClose(id)}
          onOpenInTab={handleOpenInTab}
          onDelete={handleDelete}
        />
      ))}
    </>
  )
}
