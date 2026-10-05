import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'

export interface PanelSize {
  width: number
  height: number
}

/**
 * How far the panel's size changes per pixel the grip moves. A panel pinned at its left edge grows
 * 1:1 with the grip; a centered panel grows on both sides, so it needs 2 to keep the grip under the
 * pointer. A negative `y` is a panel pinned at its bottom edge, whose grip sits on top.
 */
export interface PanelGrowth {
  x: 1 | 2
  y: 1 | 2 | -1
}

interface UseResizablePanelOptions {
  storageKey: string
  minSize: PanelSize
  growth: PanelGrowth
}

const KEYBOARD_STEP = 16
/** Direction each arrow key moves the grip, as [x, y] steps. */
const KEYBOARD_DELTAS: Partial<Record<string, readonly [number, number]>> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
}
const VIEWPORT_MARGIN = 16

function readStoredSize(storageKey: string): PanelSize | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (typeof parsed !== 'object' || parsed === null) return null
    const { width, height } = parsed as Record<string, unknown>
    if (typeof width !== 'number' || typeof height !== 'number') return null
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null
    return { width, height }
  } catch {
    return null
  }
}

function writeStoredSize(storageKey: string, size: PanelSize | null) {
  try {
    if (size) localStorage.setItem(storageKey, JSON.stringify(size))
    else localStorage.removeItem(storageKey)
  } catch {
    // Storage can be unavailable; the size then lasts only while the panel is open.
  }
}

function clampSize(size: PanelSize, minSize: PanelSize): PanelSize {
  const maxWidth = Math.max(minSize.width, window.innerWidth - VIEWPORT_MARGIN)
  const maxHeight = Math.max(minSize.height, window.innerHeight - VIEWPORT_MARGIN)
  return {
    width: Math.round(Math.min(maxWidth, Math.max(minSize.width, size.width))),
    height: Math.round(Math.min(maxHeight, Math.max(minSize.height, size.height))),
  }
}

/**
 * A user-resizable panel whose size survives closing and reopening it. `size` stays null until the
 * user resizes, so the panel keeps its content-driven default size until then.
 */
export function useResizablePanel<T extends HTMLElement>({ storageKey, minSize, growth }: UseResizablePanelOptions) {
  const panelRef = useRef<T>(null)
  const [size, setSize] = useState<PanelSize | null>(() => readStoredSize(storageKey))
  const stopDrag = useRef<(() => void) | null>(null)

  useEffect(() => () => stopDrag.current?.(), [])

  const currentSize = useCallback((): PanelSize => {
    const rect = panelRef.current?.getBoundingClientRect()
    return size ?? { width: rect?.width || minSize.width, height: rect?.height || minSize.height }
  }, [size, minSize])

  const startResize = (event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const start = currentSize()
    const origin = { x: event.clientX, y: event.clientY }
    let latest = start
    const onMove = (move: MouseEvent) => {
      latest = clampSize({
        width: start.width + (move.clientX - origin.x) * growth.x,
        height: start.height + (move.clientY - origin.y) * growth.y,
      }, minSize)
      setSize(latest)
    }
    const onUp = () => {
      stopDrag.current?.()
      writeStoredSize(storageKey, latest)
    }
    stopDrag.current?.()
    stopDrag.current = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      stopDrag.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const resetSize = () => {
    setSize(null)
    writeStoredSize(storageKey, null)
  }

  /** Arrow keys resize in the direction the grip moves; Home restores the default size. */
  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Home') {
      event.preventDefault()
      resetSize()
      return
    }
    const delta = KEYBOARD_DELTAS[event.key]
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    const start = currentSize()
    const next = clampSize({
      width: start.width + delta[0] * KEYBOARD_STEP,
      height: start.height + delta[1] * KEYBOARD_STEP * Math.sign(growth.y),
    }, minSize)
    setSize(next)
    writeStoredSize(storageKey, next)
  }

  return { panelRef, size, startResize, resizeWithKeyboard, resetSize }
}
