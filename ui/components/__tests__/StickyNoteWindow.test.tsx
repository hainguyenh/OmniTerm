/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { StickyNoteWindow } from '../StickyNoteWindow'
import { mockOmnitermAPI } from '../../testUtils'

describe('StickyNoteWindow', () => {
  beforeEach(() => {
    mockOmnitermAPI({
      tempNotes: {
        read: vi.fn().mockResolvedValue('Hello Sticky'),
        write: vi.fn().mockResolvedValue({ id: 'note-1', title: 'Hello Sticky', mtime_ms: 1000, size: 12 }),
        delete: vi.fn().mockResolvedValue(true),
        saveAs: vi.fn().mockResolvedValue('/path/to/saved.txt'),
      },
    })
  })

  it('loads note content and renders title', async () => {
    render(
      <StickyNoteWindow
        id="note-1"
        onClose={vi.fn()}
        onOpenInTab={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(await screen.findByDisplayValue('Hello Sticky')).toBeInTheDocument()
    expect(screen.getAllByText('Hello Sticky').length).toBeGreaterThanOrEqual(1)
  })

  it('triggers onOpenInTab when clicking open as editor tab button', async () => {
    const onOpenInTab = vi.fn()
    render(
      <StickyNoteWindow
        id="note-1"
        onClose={vi.fn()}
        onOpenInTab={onOpenInTab}
        onDelete={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Hello Sticky')
    fireEvent.click(screen.getByLabelText('Open as editor tab'))

    expect(onOpenInTab).toHaveBeenCalledWith('note-1', 'Hello Sticky')
  })

  it('does not drag the note when pressing a toolbar icon', async () => {
    render(
      <StickyNoteWindow
        id="note-1"
        onClose={vi.fn()}
        onOpenInTab={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await screen.findByRole('textbox', { name: 'Note content' })
    const note = screen.getByRole('dialog', { name: 'Sticky note' })
    const initialLeft = note.style.left
    const initialTop = note.style.top
    const icon = screen.getByLabelText('Open as editor tab').querySelector('svg')
    expect(icon).not.toBeNull()
    fireEvent.mouseDown(icon!, { clientX: 110, clientY: 110 })
    fireEvent.mouseMove(window, { clientX: 210, clientY: 210 })
    fireEvent.mouseUp(window)

    expect(note.style.left).toBe(initialLeft)
    expect(note.style.top).toBe(initialTop)

    fireEvent.mouseDown(screen.getByText('Hello Sticky', { selector: 'span' }), {
      clientX: 110,
      clientY: 110,
    })
    fireEvent.mouseMove(window, { clientX: 210, clientY: 210 })
    fireEvent.mouseUp(window)
    expect(note.style.left).not.toBe(initialLeft)
    expect(note.style.top).not.toBe(initialTop)
  })

  it('triggers saveAs when clicking save as button', async () => {
    const onClose = vi.fn()
    render(
      <StickyNoteWindow
        id="note-1"
        onClose={onClose}
        onOpenInTab={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Hello Sticky')
    fireEvent.click(screen.getByLabelText('Save as…'))

    await waitFor(() => {
      expect(window.omnitermAPI.tempNotes.saveAs).toHaveBeenCalledWith('note-1')
      expect(onClose).toHaveBeenCalled()
    })
  })
})
