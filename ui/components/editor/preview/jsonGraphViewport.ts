/**
 * Pan/zoom math for the JSON graph canvas and viewport culling: only nodes and edges intersecting
 * the visible world rectangle are rendered, so a 1,500-node graph costs a screenful of SVG.
 */

export interface Transform {
  x: number
  y: number
  k: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 4
/** Below this zoom text is unreadable anyway; nodes are drawn as plain boxes. */
export const TEXT_ZOOM = 0.4

const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))

/** Fit the whole graph in the viewport (never enlarging past 1:1), centred. */
export function fitTransform(bounds: Size, viewport: Size, padding = 24): Transform {
  if (bounds.width <= 0 || bounds.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { x: padding, y: padding, k: 1 }
  }
  const k = clampZoom(Math.min(
    (viewport.width - padding * 2) / bounds.width,
    (viewport.height - padding * 2) / bounds.height,
    1,
  ))
  return {
    x: Math.max(padding, (viewport.width - bounds.width * k) / 2),
    y: Math.max(padding, (viewport.height - bounds.height * k) / 2),
    k,
  }
}

/** Zoom by `factor` keeping the world point under `point` (screen coordinates) fixed. */
export function zoomAt(transform: Transform, point: { x: number; y: number }, factor: number): Transform {
  const k = clampZoom(transform.k * factor)
  const ratio = k / transform.k
  return {
    x: point.x - (point.x - transform.x) * ratio,
    y: point.y - (point.y - transform.y) * ratio,
    k,
  }
}

/** The world-space rectangle currently on screen. */
export function worldRect(transform: Transform, viewport: Size): Rect {
  return {
    x: -transform.x / transform.k,
    y: -transform.y / transform.k,
    width: viewport.width / transform.k,
    height: viewport.height / transform.k,
  }
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

export function cullNodes<T extends Rect>(nodes: readonly T[], view: Rect, margin = 100): T[] {
  const area = { x: view.x - margin, y: view.y - margin, width: view.width + margin * 2, height: view.height + margin * 2 }
  return nodes.filter((node) => intersects(node, area))
}

export function cullEdges<T extends { x1: number; y1: number; x2: number; y2: number }>(edges: readonly T[], view: Rect, margin = 100): T[] {
  const area = { x: view.x - margin, y: view.y - margin, width: view.width + margin * 2, height: view.height + margin * 2 }
  return edges.filter((edge) => intersects({
    x: Math.min(edge.x1, edge.x2),
    y: Math.min(edge.y1, edge.y2),
    width: Math.abs(edge.x2 - edge.x1) || 1,
    height: Math.abs(edge.y2 - edge.y1) || 1,
  }, area))
}
