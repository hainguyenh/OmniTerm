/**
 * Debounce repeated calls into one trailing invocation, run inside a `requestAnimationFrame` so it
 * lands after layout.
 *
 * Built for `TerminalView`'s `ResizeObserver`: a raw `new ResizeObserver(() => safeFit())` re-fits
 * (and re-sends the PTY's cols/rows) on every single callback during a drag-resize, which is a
 * SIGWINCH storm that itself corrupts full-screen TUI frames. `schedule()` collapses a burst of
 * calls into the one that matters — the settled size once the drag stops.
 */
export interface Coalescer {
  schedule: () => void
  cancel: () => void
}

export const createCoalescer = (fn: () => void, delayMs: number): Coalescer => {
  let timeout: ReturnType<typeof setTimeout> | null = null
  let raf: number | null = null

  const cancel = () => {
    if (timeout !== null) { clearTimeout(timeout); timeout = null }
    if (raf !== null) { cancelAnimationFrame(raf); raf = null }
  }

  const schedule = () => {
    cancel()
    timeout = setTimeout(() => {
      timeout = null
      raf = requestAnimationFrame(() => { raf = null; fn() })
    }, delayMs)
  }

  return { schedule, cancel }
}
