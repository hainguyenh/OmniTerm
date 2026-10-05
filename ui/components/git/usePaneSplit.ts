import { useEffect, useRef, useState } from 'react'
import type React from 'react'

interface PaneSplitBounds {
  min: number
  max: number
}

interface UsePaneSplitOptions {
  storageKey: string
  defaultValue: number
  /** Read at drag time: the limits can follow the container's current width. */
  bounds: () => PaneSplitBounds
  /** How much the value changes per pixel the divider moves, e.g. 1 for a width in pixels. */
  unitsPerPixel: () => number
  /** Arrow-key step, in value units. */
  step: number
}

function readStoredValue(storageKey: string): number | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeStoredValue(storageKey: string, value: number | null) {
  try {
    if (value === null) localStorage.removeItem(storageKey)
    else localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {
    // Storage can be unavailable; the split then lasts only for this view.
  }
}

function clampTo(value: number, { min, max }: PaneSplitBounds): number {
  return Math.min(Math.max(min, max), Math.max(min, value))
}

/**
 * A draggable divider between two side-by-side panes whose position survives reopening the view.
 * Dragging is relative to where the divider was grabbed, so the result does not depend on what sits
 * to the left of the container (activity bar, sidebars). Double-click or Home restores the default.
 */
export function usePaneSplit({ storageKey, defaultValue, bounds, unitsPerPixel, step }: UsePaneSplitOptions) {
  const [value, setValue] = useState(() => readStoredValue(storageKey) ?? defaultValue)
  const [dragging, setDragging] = useState(false)
  const stopDrag = useRef<(() => void) | null>(null)

  useEffect(() => () => stopDrag.current?.(), [])

  const commit = (next: number) => {
    setValue(next)
    writeStoredValue(storageKey, next)
  }

  const reset = () => {
    setValue(defaultValue)
    writeStoredValue(storageKey, null)
  }

  const onMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const start = clampTo(value, bounds())
    const scale = unitsPerPixel()
    let latest = start
    const onMove = (move: MouseEvent) => {
      latest = clampTo(start + (move.clientX - startX) * scale, bounds())
      setValue(latest)
    }
    const onUp = () => {
      stopDrag.current?.()
      writeStoredValue(storageKey, latest)
    }
    stopDrag.current?.()
    stopDrag.current = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDragging(false)
      stopDrag.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    setDragging(true)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Home') {
      event.preventDefault()
      reset()
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const direction = event.key === 'ArrowRight' ? 1 : -1
      commit(clampTo(value + direction * step, bounds()))
    }
  }

  const separatorProps = {
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': 'vertical',
    'aria-valuenow': Math.round(value),
    onMouseDown,
    onKeyDown,
    onDoubleClick: reset,
  } as const

  return { value, dragging, reset, separatorProps }
}
