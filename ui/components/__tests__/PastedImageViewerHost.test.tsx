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
    const { container } = render(<PastedImageViewerHost sessionId="sess-1" />)
    act(() => requestOpen('sess-1'))
    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(container).toBeEmptyDOMElement()

    act(() => requestOpen('sess-1'))
    fireEvent.click(screen.getByLabelText('Close image viewer'))
    expect(container).toBeEmptyDOMElement()

    act(() => requestOpen('sess-1'))
    fireEvent.click(screen.getByRole('presentation')) // target === currentTarget on the backdrop
    expect(container).toBeEmptyDOMElement()
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
    const { container } = render(<PastedImageViewerHost sessionId="sess-1" />)
    act(() => requestOpen('sess-1'))
    expect(screen.getByRole('dialog')).toBeTruthy()

    act(() => releasePastedImage('sess-1'))
    expect(container).toBeEmptyDOMElement()
  })
})
