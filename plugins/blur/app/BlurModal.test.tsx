/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import BlurModal from './BlurModal'

describe('BlurModal', () => {
  it('shows OFF at zero and persists slider changes with a live preview', () => {
    const onChange = vi.fn()
    render(<BlurModal value={0} onChange={onChange} onClose={vi.fn()} />)

    expect(screen.getByRole('status')).toHaveTextContent('Off')
    const slider = screen.getByRole('slider', { name: /Blur strength/ })
    fireEvent.change(slider, { target: { value: '8' } })

    expect(onChange).toHaveBeenCalledWith(8)
    expect(screen.getByRole('status')).toHaveTextContent('On')
    expect(screen.getByTestId('blur-preview-surface')).toHaveStyle({ filter: 'blur(8px)' })
  })

  it('closes from Escape and the close button', () => {
    const onClose = vi.fn()
    render(<BlurModal value={4} onChange={vi.fn()} onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByTitle('Close'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
