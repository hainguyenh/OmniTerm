import type React from 'react'
import { useRef, useState } from 'react'

export interface Point {
  x: number
  y: number
}

interface Box {
  left: number
  top: number
  width: number
}

/** How much of the dialog stays on screen, so it can always be grabbed and dragged back. */
const MIN_VISIBLE = 48

/**
 * The dialog's offset once the pointer has moved from `from` to `to`, given where the dialog sat
 * (`box`, measured at `startOffset`) when the drag began. The header row never leaves the top of the
 * window and at least `MIN_VISIBLE` pixels stay reachable on every side.
 */
export function dragOffset(startOffset: Point, from: Point, to: Point, box: Box, viewport: { width: number; height: number }): Point {
  const left = box.left + to.x - from.x
  const top = box.top + to.y - from.y
  const clampedLeft = Math.min(viewport.width - MIN_VISIBLE, Math.max(MIN_VISIBLE - box.width, left))
  const clampedTop = Math.min(viewport.height - MIN_VISIBLE, Math.max(0, top))
  return { x: startOffset.x + clampedLeft - box.left, y: startOffset.y + clampedTop - box.top }
}

interface DragStart {
  pointerId: number
  from: Point
  offset: Point
  box: Box
}

/**
 * Moves a dialog by its header: spread `handleProps` on the header and apply `style` to the dialog.
 * Presses on the header's own controls (buttons, fields) stay clicks, never drags.
 */
export function useDialogDrag(dialogRef: React.RefObject<HTMLElement | null>) {
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const start = useRef<DragStart | null>(null)

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !dialogRef.current) return
    if (event.target instanceof Element && event.target.closest('button, input, select, textarea, a')) return
    const rect = dialogRef.current.getBoundingClientRect()
    start.current = { pointerId: event.pointerId, from: { x: event.clientX, y: event.clientY }, offset, box: { left: rect.left, top: rect.top, width: rect.width } }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }
  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = start.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    setOffset(dragOffset(drag.offset, drag.from, { x: event.clientX, y: event.clientY }, drag.box, viewport))
  }
  const onPointerEnd = (event: React.PointerEvent<HTMLElement>) => {
    if (start.current?.pointerId !== event.pointerId) return
    start.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  return {
    style: { transform: `translate(${offset.x}px, ${offset.y}px)` },
    handleProps: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd },
  }
}
