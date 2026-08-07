import { useCallback, useRef } from 'react'
import type { LayoutMode } from '../themes'
import {
  fractionFromPointer, paneDividers, type SplitRatios,
} from '../paneLayout'

/**
 * Drag handles for the boundaries between panes (2- and 3-pane layouts only).
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
    key: keyof SplitRatios,
    axis: 'x' | 'y',
    invert: boolean,
  ) => {
    e.preventDefault()
    const handle = e.currentTarget
    // The pane area, not the handle: the fraction is relative to the space being divided.
    const area = handle.parentElement?.getBoundingClientRect()
    if (!area) return
    handle.setPointerCapture(e.pointerId)

    const move = (ev: PointerEvent) => {
      const next = axis === 'x'
        ? fractionFromPointer(ev.clientX, area.left, area.width, invert)
        : fractionFromPointer(ev.clientY, area.top, area.height, invert)
      onChange({ ...latest.current, [key]: next })
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      onCommit(latest.current)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }, [onChange, onCommit])

  return (
    <>
      {dividers.map(divider => {
        const vertical = divider.axis === 'x'
        // `main` measured from the right edge in the mirrored 3-pane layout.
        const invert = divider.key === 'main' && mode === 3 && split3Style === 'right'
        return (
          <div
            key={divider.key}
            role="separator"
            aria-orientation={vertical ? 'vertical' : 'horizontal'}
            aria-label={divider.key === 'main' ? 'Resize panes' : 'Resize stacked panes'}
            onPointerDown={(e) => startDrag(e, divider.key, divider.axis, invert)}
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
