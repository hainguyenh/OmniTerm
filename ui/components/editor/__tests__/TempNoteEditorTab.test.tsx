/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TempNoteEditorTab } from '../TempNoteEditorTab'
import { mockOmnitermAPI } from '../../../testUtils'

describe('TempNoteEditorTab', () => {
  beforeEach(() => {
    mockOmnitermAPI({
      tempNotes: {
        read: vi.fn().mockResolvedValue('Initial note content'),
        write: vi.fn().mockResolvedValue({ id: 'note-1', title: 'Initial note content', mtime_ms: 1000, size: 20 }),
        delete: vi.fn().mockResolvedValue(true),
        saveAs: vi.fn().mockResolvedValue('/path/to/saved.txt'),
      },
    })
  })

  it('renders loaded content', async () => {
    render(
      <TempNoteEditorTab
        tabId="temp:note-1"
        noteId="note-1"
        visible={true}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByDisplayValue('Initial note content')).toBeInTheDocument()
    expect(screen.getAllByText('Initial note content').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Saved to _temp')).toBeInTheDocument()
  })

  it('handles Ctrl+S to saveAs and close', async () => {
    const onClose = vi.fn()
    render(
      <TempNoteEditorTab
        tabId="temp:note-1"
        noteId="note-1"
        visible={true}
        onClose={onClose}
      />,
    )

    const textarea = await screen.findByDisplayValue('Initial note content')
    fireEvent.keyDown(textarea, { key: 's', ctrlKey: true })

    await waitFor(() => {
      expect(window.omnitermAPI.tempNotes.saveAs).toHaveBeenCalledWith('note-1')
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('handles tab key by inserting 2 spaces', async () => {
    render(
      <TempNoteEditorTab
        tabId="temp:note-1"
        noteId="note-1"
        visible={true}
        onClose={vi.fn()}
      />,
    )

    const textarea = (await screen.findByDisplayValue('Initial note content')) as HTMLTextAreaElement
    textarea.selectionStart = 0
    textarea.selectionEnd = 0
    fireEvent.keyDown(textarea, { key: 'Tab' })

    expect(textarea.value).toBe('  Initial note content')
  })
})
