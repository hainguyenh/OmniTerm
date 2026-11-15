import type { LayoutMode } from '../themes'

export const PANE_ZOOM_MIN = 0.5
export const PANE_ZOOM_MAX = 1
export const PANE_ZOOM_STEP = 0.05
/** Layouts with more panes than this start zoomed out so every pane stays readable. */
export const ZOOM_FROM_PANES = 4

/** 100% up to four panes, then 85% for five or six and 70% for seven or eight. */
export function defaultPaneZoom(layoutMode: LayoutMode): number {
  if (layoutMode <= ZOOM_FROM_PANES) return 1
  return layoutMode <= 6 ? 0.85 : 0.7
}

export function clampPaneZoom(zoom: number): number {
  const stepped = Math.round(zoom / PANE_ZOOM_STEP) * PANE_ZOOM_STEP
  return Math.min(PANE_ZOOM_MAX, Math.max(PANE_ZOOM_MIN, Math.round(stepped * 100) / 100))
}

/** Terminal font size at a pane zoom; never below a size that is still legible. */
export function zoomedFontSize(fontSize: number, zoom: number): number {
  if (zoom >= 1) return fontSize
  return Math.max(8, Math.round(fontSize * zoom))
}
