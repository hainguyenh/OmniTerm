/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import BlurModal from './BlurModal'

describe('BlurModal', () => {
  it('persists slider changes with a live preview', () => {
    const onSave = vi.fn()
    render(<BlurModal strength={0} blurDock={false} enabled={false} onSave={onSave} onClose={vi.fn()} />)

    const enableCheck = screen.getByLabelText(/Enable Blur/)
    fireEvent.click(enableCheck)

    const slider = screen.getByRole('slider', { name: /Blur strength/ })
    fireEvent.change(slider, { target: { value: '8' } })

    expect(screen.getByTestId('blur-preview-surface')).toHaveStyle({ filter: 'blur(8px)' })
    expect(screen.getByText('OmniTerm — Local Shell')).toBeInTheDocument()
    expect(screen.getByText('Terminal')).toBeInTheDocument()
    expect(screen.getByText('pnpm run build')).toBeInTheDocument()

    const saveBtn = screen.getByRole('button', { name: /Save Settings/ })
    fireEvent.click(saveBtn)

    expect(onSave).toHaveBeenCalledWith(8, false, true)
  })

  it('closes from Escape and the close button', () => {
    const onClose = vi.fn()
    render(<BlurModal strength={4} blurDock={false} enabled={true} onSave={vi.fn()} onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByTitle('Close'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
