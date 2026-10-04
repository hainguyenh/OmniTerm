const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8]

/** Next zoom stop above or below `current`, for the toolbar and Ctrl+wheel. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((step) => step > current + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  return [...ZOOM_STEPS].reverse().find((step) => step < current - 1e-6) ?? ZOOM_STEPS[0]
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
