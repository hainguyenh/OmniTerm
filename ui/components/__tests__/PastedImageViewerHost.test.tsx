/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PastedImageViewerHost from '../PastedImageViewerHost'
import { releasePastedImage, requestOpen, setLastPastedImage } from '../../utils/pastedImageStore'

const stubObjectUrls = () => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock-image')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
}

describe('PastedImageViewerHost', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    stubObjectUrls()
    act(() => releasePastedImage('sess-1'))
    Object.defineProperty(window, 'omnitermAPI', {
      configurable: true,
      value: { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } },
    })
  })

  it('renders nothing until an open request arrives with an image on file', () => {
    const { container } = render(<PastedImageViewerHost sessionId="sess-1" />)
    expect(container).toBeEmptyDOMElement()

    act(() => requestOpen('sess-1')) // no image yet: still nothing
    expect(container).toBeEmptyDOMElement()

    act(() => setLastPastedImage('sess-1', { bytes: new Uint8Array([1]), path: 'C:/temp/a.png' }))
    act(() => requestOpen('sess-1'))
    expect(screen.getByRole('dialog', { name: 'Last pasted image' })).toBeTruthy()
    expect(screen.getByAltText('Last image pasted into this pane')).toHaveAttribute('src', 'blob:mock-image')
    expect(screen.getByText('C:/temp/a.png')).toBeTruthy()
  })

  it('closes on Escape, the close button, and a backdrop click', () => {
    act(() => setLastPastedImage('sess-1', { bytes: new Uint8Array([1]), path: 'C:/temp/a.png' }))
    render(<PastedImageViewerHost sessionId="sess-1" />)
    act(() => requestOpen('sess-1'))
    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    act(() => requestOpen('sess-1'))
    fireEvent.click(screen.getByLabelText('Close image viewer'))
    expect(screen.queryByRole('dialog')).toBeNull()

    act(() => requestOpen('sess-1'))
    fireEvent.click(screen.getByRole('presentation')) // target === currentTarget on the backdrop
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('clicking a control inside the dialog does not close it', async () => {
    act(() => setLastPastedImage('sess-1', { bytes: new Uint8Array([1]), path: 'C:/temp/a.png' }))
    render(<PastedImageViewerHost sessionId="sess-1" />)
    act(() => requestOpen('sess-1'))

    // Async act: the copy button's write resolves a microtask later and flips the check icon;
    // awaiting inside act keeps that update wrapped instead of warning.
    await act(async () => { fireEvent.click(screen.getByLabelText('Copy image path')) })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(window.omnitermAPI.clipboard.writeText).toHaveBeenCalledWith('C:/temp/a.png')
  })

  it('closes itself when the slot empties (image released or pane replaced)', () => {
    act(() => setLastPastedImage('sess-1', { bytes: new Uint8Array([1]), path: 'C:/temp/a.png' }))
    render(<PastedImageViewerHost sessionId="sess-1" />)
    act(() => requestOpen('sess-1'))
    expect(screen.getByRole('dialog')).toBeTruthy()

    act(() => releasePastedImage('sess-1'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('hides the pager for a single image', () => {
    act(() => setLastPastedImage('sess-1', { bytes: new Uint8Array([1]), path: 'C:/temp/a.png' }))
    render(<PastedImageViewerHost sessionId="sess-1" />)
    act(() => requestOpen('sess-1'))

    expect(screen.queryByLabelText('Previous image')).toBeNull()
    expect(screen.queryByLabelText('Next image')).toBeNull()
    expect(screen.getByText('C:/temp/a.png')).toBeTruthy()
  })

  it('opens on the newest paste and flips back and forth with the chevrons', () => {
    act(() => setLastPastedImage('sess-1', { bytes: new Uint8Array([1]), path: 'C:/temp/a.png' }))
    act(() => setLastPastedImage('sess-1', { bytes: new Uint8Array([2]), path: 'C:/temp/b.png' }))
    render(<PastedImageViewerHost sessionId="sess-1" />)
    act(() => requestOpen('sess-1'))

    expect(screen.getByText('2 / 2')).toBeTruthy()
    expect(screen.getByText('C:/temp/b.png')).toBeTruthy()
    expect(screen.getByLabelText('Next image')).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByLabelText('Previous image'))
    expect(screen.getByText('1 / 2')).toBeTruthy()
    expect(screen.getByText('C:/temp/a.png')).toBeTruthy()
    expect(screen.getByLabelText('Previous image')).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByLabelText('Next image'))
    expect(screen.getByText('2 / 2')).toBeTruthy()
  })

  it('flips through the history with Left/Right and jumps to new pastes while open', () => {
    act(() => setLastPastedImage('sess-1', { bytes: new Uint8Array([1]), path: 'C:/temp/a.png' }))
    act(() => setLastPastedImage('sess-1', { bytes: new Uint8Array([2]), path: 'C:/temp/b.png' }))
    render(<PastedImageViewerHost sessionId="sess-1" />)
    act(() => requestOpen('sess-1'))
    expect(screen.getByText('2 / 2')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(screen.getByText('1 / 2')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'ArrowLeft' }) // clamped at the oldest
    expect(screen.getByText('1 / 2')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(screen.getByText('2 / 2')).toBeTruthy()

    // A paste made while the viewer is open jumps straight to the new image.
    act(() => setLastPastedImage('sess-1', { bytes: new Uint8Array([3]), path: 'C:/temp/c.png' }))
    expect(screen.getByText('3 / 3')).toBeTruthy()
    expect(screen.getByText('C:/temp/c.png')).toBeTruthy()
  })
})
