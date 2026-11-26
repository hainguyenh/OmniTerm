/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { StickyNotesToolWindow } from '../StickyNotesToolWindow'

const list = vi.fn()

describe('StickyNotesToolWindow', () => {
  beforeEach(() => {
    list.mockResolvedValue([{ id: 'note-1', title: 'Todo', mtime_ms: Date.now(), size: 4 }])
    ;(window as unknown as { omnitermAPI: unknown }).omnitermAPI = { tempNotes: { list, delete: vi.fn() } }
  })
  afterEach(() => {
    delete (window as unknown as { omnitermAPI?: unknown }).omnitermAPI
  })

  it('lists the temporary notes and opens one as a floating note', async () => {
    const opened = vi.fn()
    window.addEventListener('omniterm:open-sticky-note', opened)
    render(<StickyNotesToolWindow />)
    fireEvent.click(await screen.findByText('Todo'))
    expect(opened).toHaveBeenCalledTimes(1)
    window.removeEventListener('omniterm:open-sticky-note', opened)
  })

  it('asks for a new note and reloads when notes change', async () => {
    const created = vi.fn()
    window.addEventListener('omniterm:new-temp-note', created)
    render(<StickyNotesToolWindow />)
    await screen.findByText('Todo')
    fireEvent.click(screen.getByLabelText('New sticky note'))
    expect(created).toHaveBeenCalledTimes(1)
    list.mockResolvedValue([])
    await act(async () => window.dispatchEvent(new CustomEvent('omniterm:temp-notes-changed')))
    expect(await screen.findByText('No temporary notes')).toBeTruthy()
    window.removeEventListener('omniterm:new-temp-note', created)
  })
})
