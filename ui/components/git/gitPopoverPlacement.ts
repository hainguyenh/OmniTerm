import type React from 'react'

import type { PanelSize } from './useResizablePanel'

export type AnchorRect = DOMRect | { top: number; left: number; bottom: number; right: number }

export const QUICK_POPOVER_WIDTH = 340
const QUICK_POPOVER_MAX_HEIGHT = 480
const EDGE = 8
const GAP = 4

/** An anchor this close to the bottom (the footer) opens the popover upward. */
export function opensUpward(anchorRect?: AnchorRect | null): boolean {
  if (!anchorRect) return true
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800
  return anchorRect.bottom > viewportHeight - 280
}

/**
 * Fixed placement of the quick branch popover next to its anchor. A user-chosen `size` replaces the
 * default width and content-driven height, still capped by the room between anchor and viewport edge.
 */
export function computePopoverStyle(anchorRect?: AnchorRect | null, size?: PanelSize | null): React.CSSProperties {
  const width = size?.width ?? QUICK_POPOVER_WIDTH
  const height = size?.height
  if (!anchorRect) {
    return {
      position: 'fixed',
      bottom: 36,
      left: 12,
      width,
      height,
      maxHeight: size ? undefined : QUICK_POPOVER_MAX_HEIGHT,
      zIndex: 9999,
    }
  }
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200
  const left = Math.max(EDGE, Math.min(anchorRect.left, viewportWidth - width - EDGE))

  if (opensUpward(anchorRect)) {
    const bottom = Math.max(EDGE, viewportHeight - anchorRect.top + GAP)
    const room = viewportHeight - bottom - EDGE
    return {
      position: 'fixed',
      bottom,
      left,
      width,
      height,
      maxHeight: size ? room : Math.min(QUICK_POPOVER_MAX_HEIGHT, viewportHeight - 32),
      zIndex: 9999,
    }
  }

  const top = Math.max(EDGE, anchorRect.bottom + GAP)
  const room = viewportHeight - top - EDGE
  return {
    position: 'fixed',
    top,
    left,
    width,
    height,
    maxHeight: size ? room : Math.min(QUICK_POPOVER_MAX_HEIGHT, viewportHeight - 32),
    zIndex: 9999,
  }
}
