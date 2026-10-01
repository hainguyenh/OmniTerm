/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import React, { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { dragOffset, useDialogDrag } from '../dialogDrag'

describe('dragOffset', () => {
  const box = { left: 100, top: 100, width: 400 }
  const viewport = { width: 1000, height: 800 }
  const startOffset = { x: 0, y: 0 }

  it('translates by delta when within viewport bounds', () => {
    const from = { x: 200, y: 200 }
    const to = { x: 250, y: 280 }
    const offset = dragOffset(startOffset, from, to, box, viewport)
    expect(offset).toEqual({ x: 50, y: 80 })
  })

  it('clamps top to not leave the window top', () => {
    const from = { x: 200, y: 200 }
    const to = { x: 200, y: 50 } // delta -150, would put top at -50
    const offset = dragOffset(startOffset, from, to, box, viewport)
    expect(offset.y).toBe(-100) // 100 - 100 = 0 (top clamped to 0)
  })

  it('clamps left and right to keep at least MIN_VISIBLE reachable', () => {
    const from = { x: 200, y: 200 }
    const to = { x: 1200, y: 200 } // dragged way to the right
    const offset = dragOffset(startOffset, from, to, box, viewport)
    // viewport.width - 48 = 952. 952 - 100 = 852.
    expect(offset.x).toBe(852)
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

    // Start drag
    fireEvent.pointerDown(handle, { button: 0, pointerId: 10, clientX: 120, clientY: 120 })
    expect(setCapture).toHaveBeenCalledWith(10)

    // Unrelated pointer move is ignored
    fireEvent.pointerMove(handle, { pointerId: 99, clientX: 200, clientY: 200 })
    expect(dialog.style.transform).toBe('translate(0px, 0px)')

    // Valid pointer move
    fireEvent.pointerMove(handle, { pointerId: 10, clientX: 170, clientY: 160 })
    expect(dialog.style.transform).toBe('translate(50px, 40px)')

    // Unrelated pointer up is ignored
    fireEvent.pointerUp(handle, { pointerId: 99 })
    expect(releaseCapture).not.toHaveBeenCalled()

    // Valid pointer up terminates drag
    fireEvent.pointerUp(handle, { pointerId: 10 })
    expect(releaseCapture).toHaveBeenCalledWith(10)

    // Further move does not change transform
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

    // Move after cancel is ignored
    fireEvent.pointerMove(handle, { pointerId: 12, clientX: 200, clientY: 200 })
    expect(dialog.style.transform).toBe('translate(20px, 20px)')
  })
})
