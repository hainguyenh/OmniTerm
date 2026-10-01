/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import React, { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { dragOffset, useDialogDrag } from './dialogDrag'

const VIEWPORT = { width: 1000, height: 800 }
const BOX = { left: 200, top: 100, width: 600 }
const ORIGIN = { x: 0, y: 0 }

describe('dragOffset', () => {
  it('follows the pointer from where the drag began', () => {
    expect(dragOffset(ORIGIN, { x: 300, y: 120 }, { x: 350, y: 180 }, BOX, VIEWPORT)).toEqual({ x: 50, y: 60 })
    // A second drag starts from the offset the first one left.
    expect(dragOffset({ x: 50, y: 60 }, { x: 10, y: 10 }, { x: 0, y: 30 }, { ...BOX, left: 250, top: 160 }, VIEWPORT)).toEqual({ x: 40, y: 80 })
  })

  it('keeps the header on screen and some of the dialog reachable', () => {
    // Up past the top edge: the header stops at the top of the window.
    expect(dragOffset(ORIGIN, { x: 0, y: 0 }, { x: 0, y: -500 }, BOX, VIEWPORT).y).toBe(-100)
    // Down past the bottom: 48px stay visible.
    expect(dragOffset(ORIGIN, { x: 0, y: 0 }, { x: 0, y: 2000 }, BOX, VIEWPORT).y).toBe(800 - 48 - 100)
    // Sideways, 48px stay reachable on either side.
    expect(dragOffset(ORIGIN, { x: 0, y: 0 }, { x: -5000, y: 0 }, BOX, VIEWPORT).x).toBe(48 - 600 - 200)
    expect(dragOffset(ORIGIN, { x: 0, y: 0 }, { x: 5000, y: 0 }, BOX, VIEWPORT).x).toBe(1000 - 48 - 200)
  })
})

function TestDialog({ attachRef = true }: { attachRef?: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const nullRef = useRef<HTMLDivElement | null>(null)
  const { style, handleProps } = useDialogDrag(attachRef ? dialogRef : nullRef)
  return React.createElement(
    'div',
    { ref: dialogRef, style, 'data-testid': 'dialog' },
    React.createElement(
      'div',
      { ...handleProps, 'data-testid': 'handle' },
      'Header',
      React.createElement('button', { type: 'button', 'data-testid': 'button' }, 'Close'),
    ),
  )
}

describe('useDialogDrag', () => {
  it('ignores non-primary pointer clicks', () => {
    render(React.createElement(TestDialog))
    const handle = screen.getByTestId('handle')
    const dialog = screen.getByTestId('dialog')

    fireEvent.pointerDown(handle, { button: 1, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150, clientY: 150 })

    expect(dialog.style.transform).toBe('translate(0px, 0px)')
  })

  it('ignores pointer events when dialogRef.current is null', () => {
    render(React.createElement(TestDialog, { attachRef: false }))
    const handle = screen.getByTestId('handle')
    const dialog = screen.getByTestId('dialog')

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150, clientY: 150 })

    expect(dialog.style.transform).toBe('translate(0px, 0px)')
  })

  it('ignores pointer down on interactive child controls', () => {
    render(React.createElement(TestDialog))
    const button = screen.getByTestId('button')
    const handle = screen.getByTestId('handle')
    const dialog = screen.getByTestId('dialog')

    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150, clientY: 150 })

    expect(dialog.style.transform).toBe('translate(0px, 0px)')
  })

  it('drags dialog smoothly and releases pointer capture on pointerUp', () => {
    render(React.createElement(TestDialog))
    const handle = screen.getByTestId('handle')
    const dialog = screen.getByTestId('dialog')

    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 100,
      width: 400,
      height: 200,
      right: 500,
      bottom: 300,
      x: 100,
      y: 100,
      toJSON: () => {},
    })

    const setCapture = vi.fn()
    const releaseCapture = vi.fn()
    handle.setPointerCapture = setCapture
    handle.releasePointerCapture = releaseCapture

    fireEvent.pointerDown(handle, { button: 0, pointerId: 10, clientX: 120, clientY: 120 })
    expect(setCapture).toHaveBeenCalledWith(10)

    fireEvent.pointerMove(handle, { pointerId: 99, clientX: 200, clientY: 200 })
    expect(dialog.style.transform).toBe('translate(0px, 0px)')

    fireEvent.pointerMove(handle, { pointerId: 10, clientX: 170, clientY: 160 })
    expect(dialog.style.transform).toBe('translate(50px, 40px)')

    fireEvent.pointerUp(handle, { pointerId: 99 })
    expect(releaseCapture).not.toHaveBeenCalled()

    fireEvent.pointerUp(handle, { pointerId: 10 })
    expect(releaseCapture).toHaveBeenCalledWith(10)

    fireEvent.pointerMove(handle, { pointerId: 10, clientX: 300, clientY: 300 })
    expect(dialog.style.transform).toBe('translate(50px, 40px)')
  })

  it('cancels drag on pointerCancel', () => {
    render(React.createElement(TestDialog))
    const handle = screen.getByTestId('handle')
    const dialog = screen.getByTestId('dialog')

    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 100,
      width: 400,
      height: 200,
      right: 500,
      bottom: 300,
      x: 100,
      y: 100,
      toJSON: () => {},
    })

    fireEvent.pointerDown(handle, { button: 0, pointerId: 12, clientX: 120, clientY: 120 })
    fireEvent.pointerMove(handle, { pointerId: 12, clientX: 140, clientY: 140 })
    expect(dialog.style.transform).toBe('translate(20px, 20px)')

    fireEvent.pointerCancel(handle, { pointerId: 12 })

    fireEvent.pointerMove(handle, { pointerId: 12, clientX: 200, clientY: 200 })
    expect(dialog.style.transform).toBe('translate(20px, 20px)')
  })
})
