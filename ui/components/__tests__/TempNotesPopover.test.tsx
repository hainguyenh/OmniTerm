/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TempNotesPopover } from '../TempNotesPopover'
import { mockOmnitermAPI } from '../../testUtils'

describe('TempNotesPopover', () => {
  beforeEach(() => {
    mockOmnitermAPI({
      tempNotes: {
        list: vi.fn().mockResolvedValue([
          { id: 'note-1', title: 'Note 1 preview', mtime_ms: Date.now() - 5000, size: 20 },
          { id: 'note-2', title: 'Note 2 preview', mtime_ms: Date.now() - 60000, size: 40 },
        ]),
        delete: vi.fn().mockResolvedValue(true),
      },
    })
  })

  it('renders list of notes', async () => {
    render(
      <TempNotesPopover
        anchorRect={null}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByText('Note 1 preview')).toBeInTheDocument()
    expect(screen.getByText('Note 2 preview')).toBeInTheDocument()
    expect(screen.getByText('(2)')).toBeInTheDocument()
  })

  it('dispatches open-sticky-note when clicking a note item', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    const onClose = vi.fn()

    render(
      <TempNotesPopover
        anchorRect={null}
        onClose={onClose}
      />,
    )

    const item = await screen.findByRole('button', { name: /Note 1 preview/ })
    fireEvent.click(item)

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'omniterm:open-sticky-note',
        detail: { id: 'note-1' },
      }),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('opens an editor tab without opening the sticky window', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    render(<TempNotesPopover anchorRect={null} onClose={vi.fn()} />)
    await screen.findByRole('button', { name: /Note 1 preview/ })
    dispatchSpy.mockClear()

    fireEvent.click(screen.getAllByLabelText('Open in editor tab')[0])

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'omniterm:open-temp-tab',
        detail: { id: 'note-1', title: 'Note 1 preview' },
      }),
    )
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'omniterm:open-sticky-note' }),
    )
  })
})
