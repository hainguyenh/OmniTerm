/** A viewport point (client coordinates) the menu opens at. */
export interface MenuPoint {
  x: number
  y: number
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

const EDGE = 8

/**
 * Where a `menu`-sized box opens for a click at `point`, in `container`-relative coordinates: at the
 * pointer like a native context menu, flipped to the other side of it when it would overflow, then
 * clamped so it stays fully inside the container.
 */
export function placeMenu(point: MenuPoint, container: Box, menu: { width: number; height: number }) {
  const axis = (at: number, size: number, room: number) => {
    const fits = at + size <= room - EDGE
    const start = fits ? at : at - size
    return Math.max(EDGE, Math.min(start, room - size - EDGE))
  }
  return {
    left: axis(point.x - container.left, menu.width, container.width),
    top: axis(point.y - container.top, menu.height, container.height),
  }
}

/** The point for a menu opened from an element rather than the pointer (keyboard, "…" button). */
export function pointBelow(element: Element): MenuPoint {
  const rect = element.getBoundingClientRect()
  return { x: rect.left, y: rect.bottom }
}
