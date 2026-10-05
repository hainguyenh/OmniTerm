/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { usePaneSplit } from '../usePaneSplit'

const KEY = 'test:split'

function Splitter({ unitsPerPixel = 1 }: { unitsPerPixel?: number }) {
  const split = usePaneSplit({
    storageKey: KEY,
    defaultValue: 300,
    bounds: () => ({ min: 200, max: 500 }),
    unitsPerPixel: () => unitsPerPixel,
    step: 10,
  })
  return (
    <div data-testid="host" data-dragging={split.dragging} data-value={split.value}>
      <div {...split.separatorProps} aria-label="divider" />
    </div>
  )
}

const value = () => Number(screen.getByTestId('host').dataset.value)

beforeEach(() => localStorage.clear())

describe('usePaneSplit', () => {
  it('follows the pointer from where the divider was grabbed, within the bounds', () => {
    render(<Splitter />)
    const divider = screen.getByRole('separator', { name: 'divider' })
    fireEvent.mouseDown(divider, { clientX: 1000 })
    expect(screen.getByTestId('host').dataset.dragging).toBe('true')
    fireEvent.mouseMove(window, { clientX: 1050 })
    expect(value()).toBe(350)
    fireEvent.mouseMove(window, { clientX: 0 })
    expect(value()).toBe(200)
    fireEvent.mouseMove(window, { clientX: 9000 })
    expect(value()).toBe(500)
    fireEvent.mouseUp(window)
    expect(screen.getByTestId('host').dataset.dragging).toBe('false')
    expect(localStorage.getItem(KEY)).toBe('500')
    fireEvent.mouseMove(window, { clientX: 1000 })
    expect(value()).toBe(500)
  })

  it('scales pointer movement into value units', () => {
    render(<Splitter unitsPerPixel={0.5} />)
    fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 200 })
    expect(value()).toBe(350)
    fireEvent.mouseUp(window)
  })

  it('ignores a non-primary button', () => {
    render(<Splitter />)
    fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 100, button: 2 })
    fireEvent.mouseMove(window, { clientX: 200 })
    expect(value()).toBe(300)
  })

  it('steps with the arrow keys and resets with Home or a double-click', () => {
    render(<Splitter />)
    const divider = screen.getByRole('separator')
    fireEvent.keyDown(divider, { key: 'ArrowRight' })
    fireEvent.keyDown(divider, { key: 'ArrowRight' })
    expect(value()).toBe(320)
    fireEvent.keyDown(divider, { key: 'ArrowLeft' })
    expect(value()).toBe(310)
    expect(localStorage.getItem(KEY)).toBe('310')
    fireEvent.keyDown(divider, { key: 'Home' })
    expect(value()).toBe(300)
    expect(localStorage.getItem(KEY)).toBeNull()
    fireEvent.keyDown(divider, { key: 'ArrowLeft' })
    fireEvent.doubleClick(divider)
    expect(value()).toBe(300)
  })

  it('restores a stored position and ignores a corrupt one', () => {
    localStorage.setItem(KEY, '420')
    const { unmount } = render(<Splitter />)
    expect(value()).toBe(420)
    unmount()
    localStorage.setItem(KEY, '{bad')
    render(<Splitter />)
    expect(value()).toBe(300)
  })
})
