/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ImagePreview } from '../ImagePreview'
import { formatBytes, stepZoom } from '../imageZoom'
import { SvgPreview } from '../SvgPreview'

describe('imageZoom', () => {
  it('steps between fixed zoom stops and clamps at both ends', () => {
    expect(stepZoom(1, 1)).toBe(1.5)
    expect(stepZoom(1, -1)).toBe(0.75)
    expect(stepZoom(1.2, 1)).toBe(1.5)
    expect(stepZoom(1.2, -1)).toBe(1)
    expect(stepZoom(8, 1)).toBe(8)
    expect(stepZoom(0.1, -1)).toBe(0.1)
  })

  it('formats byte counts for the details line', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB')
  })
})

function loadImage(width: number, height: number) {
  const image = screen.getByRole('img') as HTMLImageElement
  Object.defineProperty(image, 'naturalWidth', { value: width, configurable: true })
  Object.defineProperty(image, 'naturalHeight', { value: height, configurable: true })
  fireEvent.load(image)
  return image
}

describe('ImagePreview', () => {
  it('fits by default, then zooms from the toolbar and with Ctrl+wheel', () => {
    render(<ImagePreview src="blob:x" alt="logo.png" sizeBytes={2048} />)
    const image = loadImage(32, 16)
    expect(screen.getByText('32 × 16 · 2 KB')).toBeInTheDocument()
    expect(screen.getByText('Fit')).toBeInTheDocument()
    expect(image.style.width).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Actual size' }))
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(image.style.width).toBe('32px')

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByText('150%')).toBeInTheDocument()
    expect(image.style.height).toBe('24px')

    const stage = image.parentElement as HTMLElement
    fireEvent.wheel(stage, { deltaY: -1, ctrlKey: true })
    expect(screen.getByText('200%')).toBeInTheDocument()
    fireEvent.wheel(stage, { deltaY: 1 })
    expect(screen.getByText('200%')).toBeInTheDocument()
    fireEvent.wheel(stage, { deltaY: 1, ctrlKey: true })
    expect(screen.getByText('150%')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Fit to view' }))
    expect(screen.getByText('Fit')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(screen.getByText('75%')).toBeInTheDocument()
  })

  it('explains an image the browser cannot decode', () => {
    render(<ImagePreview src="blob:bad" alt="broken.png" />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByRole('status')).toHaveTextContent('could not be decoded')
  })
})

describe('SvgPreview', () => {
  beforeEach(() => {
    let next = 0
    URL.createObjectURL = vi.fn(() => `blob:svg-${++next}`) as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
  })

  it('renders the source as an inert svg image and replaces the URL on edit', () => {
    const { rerender, unmount } = render(<SvgPreview text="<svg/>" fileName="icon.svg" />)
    expect(screen.getByRole('img', { name: 'icon.svg' })).toHaveAttribute('src', 'blob:svg-1')
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect(blob.type).toBe('image/svg+xml')

    rerender(<SvgPreview text={'<svg width="2"/>'} fileName="icon.svg" />)
    expect(screen.getByRole('img', { name: 'icon.svg' })).toHaveAttribute('src', 'blob:svg-2')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:svg-1')
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:svg-2')
  })
})
