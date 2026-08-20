import { useCallback, useRef } from 'react'
import type { LayoutMode } from '../themes'
import {
  fractionFromPointer, paneDividers, setDividerRatio, type PaneDividerKey, type SplitRatios,
} from '../paneLayout'

/**
 * Drag handles for the boundaries between panes in every multi-pane layout.
 *
 * Rendered above the pane frames but below their content, and only 7px wide, so the terminals keep
 * their full area and a drag cannot be mistaken for a click inside a pane. Pointer capture means the
 * drag survives the cursor crossing over a terminal or leaving the window, which a plain
 * mousemove-on-window listener does not.
 *
 * `onCommit` fires once at the end of a drag: the live ratio updates on every move (so the terminals
 * reflow as you drag), but only the settled value is worth persisting.
 */
export function PaneResizers({
  mode,
  split3Style,
  split2Style,
  ratios,
  onChange,
  onCommit,
}: {
  mode: LayoutMode
  split3Style: 'left' | 'right' | 'top'
  split2Style: 'columns' | 'rows'
  ratios: SplitRatios
  onChange: (next: SplitRatios) => void
  onCommit: (next: SplitRatios) => void
}) {
  // The latest ratios, so a drag in progress reads current values without re-binding its handlers.
  const latest = useRef(ratios)
  latest.current = ratios

  const dividers = paneDividers(mode, split3Style, split2Style, ratios)

  const startDrag = useCallback((
    e: React.PointerEvent<HTMLDivElement>,
    key: PaneDividerKey,
    axis: 'x' | 'y',
    invert: boolean,
    minFraction?: number,
    maxFraction?: number,
    pointerMinFraction?: number,
    pointerMaxFraction?: number,
    pointerToRatio?: (fraction: number) => number,
  ) => {
    e.preventDefault()
    const handle = e.currentTarget
    // The pane area, not the handle: the fraction is relative to the space being divided.
    const areaElement = handle.parentElement
    if (!areaElement) return
    handle.setPointerCapture(e.pointerId)
    let frameId: number | null = null
    let pending: SplitRatios | null = null

    const flush = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
        frameId = null
      }
      const nextRatios = pending
      pending = null
      if (nextRatios) onChange(nextRatios)
    }

    const move = (ev: PointerEvent) => {
      const area = areaElement.getBoundingClientRect()
      const pointerFraction = axis === 'x'
        ? fractionFromPointer(ev.clientX, area.left, area.width, invert, pointerMinFraction ?? minFraction, pointerMaxFraction ?? maxFraction)
        : fractionFromPointer(ev.clientY, area.top, area.height, invert, pointerMinFraction ?? minFraction, pointerMaxFraction ?? maxFraction)
      const next = pointerToRatio?.(pointerFraction) ?? pointerFraction
      const nextRatios = setDividerRatio(latest.current, mode, key, next)
      latest.current = nextRatios
      pending = nextRatios
      if (frameId === null) {
        frameId = window.requestAnimationFrame(() => {
          frameId = null
          const scheduled = pending
          pending = null
          if (scheduled) onChange(scheduled)
        })
      }
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      flush()
      onCommit(latest.current)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }, [mode, onChange, onCommit])

  return (
    <>
      {dividers.map(divider => {
        const vertical = divider.axis === 'x'
        // `main` is measured from the right edge in every mirrored main-pane layout.
        const invert = divider.key === 'main' && (mode === 3 || mode === 5 || mode === 7) && split3Style === 'right'
        return (
          <div
            key={divider.key}
            role="separator"
            aria-orientation={vertical ? 'vertical' : 'horizontal'}
            aria-label={divider.key.startsWith('column-') ? 'Resize columns' : divider.key.startsWith('row-') ? 'Resize rows' : divider.key === 'main' ? 'Resize panes' : 'Resize stacked panes'}
            onPointerDown={(e) => startDrag(
              e,
              divider.key,
              divider.axis,
              invert,
              divider.minFraction,
              divider.maxFraction,
              divider.pointerMinFraction,
              divider.pointerMaxFraction,
              divider.pointerToRatio,
            )}
            className={`absolute z-20 group ${vertical ? 'cursor-col-resize' : 'cursor-row-resize'}`}
            style={{
              ...divider.style,
              ...(vertical ? { width: 7, marginLeft: -3 } : { height: 7, marginTop: -3 }),
              touchAction: 'none',
            }}
          >
            {/* A 1px line that thickens on hover — the hit area stays 7px either way. */}
            <div
              className={`absolute bg-transparent group-hover:bg-theme-accent transition-colors ${
                vertical ? 'inset-y-0 left-1/2 w-px -translate-x-1/2' : 'inset-x-0 top-1/2 h-px -translate-y-1/2'
              }`}
            />
          </div>
        )
      })}
    </>
  )
}
