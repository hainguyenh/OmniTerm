/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PaneZoomControl } from '../PaneZoomControl'

const handlers = () => ({ onStep: vi.fn(), onAuto: vi.fn() })

describe('PaneZoomControl', () => {
  it('steps the font up and down', () => {
    const h = handlers()
    render(<PaneZoomControl zoom={0.7} manual={false} {...h} />)
    expect(screen.getByLabelText('Pane zoom').textContent).toBe('70%')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom panes out' }))
    expect(h.onStep).toHaveBeenLastCalledWith(-1)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom panes in' }))
    expect(h.onStep).toHaveBeenLastCalledWith(1)
  })

  it('returns to the automatic zoom on a double click of the percentage', () => {
    const h = handlers()
    render(<PaneZoomControl zoom={0.7} manual {...h} />)
    fireEvent.doubleClick(screen.getByLabelText('Pane zoom'))
    expect(h.onAuto).toHaveBeenCalledTimes(1)
  })

  it('disables the buttons at the limits', () => {
    const { rerender } = render(<PaneZoomControl zoom={0.5} manual={false} {...handlers()} />)
    expect((screen.getByRole('button', { name: 'Zoom panes out' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<PaneZoomControl zoom={1} manual {...handlers()} />)
    expect((screen.getByRole('button', { name: 'Zoom panes in' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
