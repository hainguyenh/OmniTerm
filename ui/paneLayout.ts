/**
 * paneLayout.ts — where each pane sits, and where its dividers are
 *
 * Panes are absolutely positioned with percentage rects rather than a CSS grid, which is what makes
 * them draggable: the split positions are plain numbers in state, so a divider drag is one setState.
 *
 * Only the 2- and 3-pane layouts are adjustable. The dense grids (4/6/8) stay evenly divided — with
 * eight panes there is no useful drag, and every extra divider is another way to nudge a terminal into
 * an unreadable width.
 */

import type { CSSProperties } from 'react'
import type { LayoutMode } from './themes'

/** Where the adjustable splits sit, as fractions of the pane area. */
export interface SplitRatios {
  /** The primary split: the boundary between pane 0 and the rest. */
  main: number
  /** The secondary split: where the two stacked panes of a 3-pane layout meet. */
  cross: number
}

export const DEFAULT_RATIOS: SplitRatios = { main: 0.5, cross: 0.5 }

/**
 * Keep a pane from being dragged to nothing. A terminal below ~15% is unreadable, and a zero-width
 * pane cannot be dragged back out because its divider would be off the edge.
 */
export const MIN_FRACTION = 0.15

export function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(1 - MIN_FRACTION, Math.max(MIN_FRACTION, value))
}

/** Normalize whatever came out of persisted settings — an older build wrote no ratios at all. */
export function toRatios(saved?: Partial<SplitRatios> | null): SplitRatios {
  return {
    main: clampFraction(saved?.main ?? DEFAULT_RATIOS.main),
    cross: clampFraction(saved?.cross ?? DEFAULT_RATIOS.cross),
  }
}

const pct = (fraction: number): string => `${(fraction * 100).toFixed(3)}%`

/**
 * Percentage rect (left/top/width/height) for pane `i`.
 *
 * 1 → full; 2 → two columns or rows split at `main`; 3 → one full-height (or full-width) pane at
 * `main` with the other two stacked and split at `cross`; 4 → 2×2; 6 → 3×2; 8 → 4×2.
 */
export function paneRect(
  i: number,
  mode: LayoutMode,
  split3Style: 'left' | 'right' | 'top' = 'left',
  split2Style: 'columns' | 'rows' = 'columns',
  ratios: SplitRatios = DEFAULT_RATIOS,
): CSSProperties {
  const main = clampFraction(ratios.main)
  const cross = clampFraction(ratios.cross)

  if (mode === 1) return { left: '0%', top: '0%', width: '100%', height: '100%' }

  if (mode === 2) {
    return split2Style === 'rows'
      ? i === 0
        ? { left: '0%', top: '0%', width: '100%', height: pct(main) }
        : { left: '0%', top: pct(main), width: '100%', height: pct(1 - main) }
      : i === 0
        ? { left: '0%', top: '0%', width: pct(main), height: '100%' }
        : { left: pct(main), top: '0%', width: pct(1 - main), height: '100%' }
  }

  if (mode === 3) {
    if (split3Style === 'top') {
      // One pane across the top; the other two side by side beneath it.
      if (i === 0) return { left: '0%', top: '0%', width: '100%', height: pct(main) }
      if (i === 1) return { left: '0%', top: pct(main), width: pct(cross), height: pct(1 - main) }
      return { left: pct(cross), top: pct(main), width: pct(1 - cross), height: pct(1 - main) }
    }
    // One full-height pane on one side; the other two stacked on the other.
    // `main` always sizes the full-height pane, so the stacked pair gets the remainder — on whichever
    // side the full-height pane is not.
    const onLeft = split3Style === 'left'
    const stackLeft = onLeft ? pct(main) : '0%'
    const stackWidth = pct(1 - main)
    if (i === 0) {
      return onLeft
        ? { left: '0%', top: '0%', width: pct(main), height: '100%' }
        : { left: pct(1 - main), top: '0%', width: pct(main), height: '100%' }
    }
    if (i === 1) return { left: stackLeft, top: '0%', width: stackWidth, height: pct(cross) }
    return { left: stackLeft, top: pct(cross), width: stackWidth, height: pct(1 - cross) }
  }

  if (mode === 4) {
    return { left: pct((i % 2) * 0.5), top: pct(Math.floor(i / 2) * 0.5), width: '50%', height: '50%' }
  }
  if (mode === 6) {
    return {
      left: pct((i % 3) / 3),
      top: pct(Math.floor(i / 3) * 0.5),
      width: '33.333%',
      height: '50%',
    }
  }
  // mode === 8 → 4 columns × 2 rows
  return { left: pct((i % 4) * 0.25), top: pct(Math.floor(i / 4) * 0.5), width: '25%', height: '50%' }
}

/** A draggable boundary: which ratio it moves, which way it moves, and where to draw it. */
export interface PaneDivider {
  key: keyof SplitRatios
  axis: 'x' | 'y'
  /** Position and extent of the *track* the handle is drawn on, as CSS percentages. */
  style: CSSProperties
}

/**
 * The dividers for `mode`, or an empty list when the layout is not adjustable.
 *
 * `main` is always the outer boundary; `cross` splits the stacked pair, so its track spans only that
 * pair's half of the area — dragging it must not look like it could move the outer split.
 */
export function paneDividers(
  mode: LayoutMode,
  split3Style: 'left' | 'right' | 'top' = 'left',
  split2Style: 'columns' | 'rows' = 'columns',
  ratios: SplitRatios = DEFAULT_RATIOS,
): PaneDivider[] {
  const main = clampFraction(ratios.main)
  const cross = clampFraction(ratios.cross)

  if (mode === 2) {
    return split2Style === 'rows'
      ? [{ key: 'main', axis: 'y', style: { left: '0%', top: pct(main), width: '100%' } }]
      : [{ key: 'main', axis: 'x', style: { left: pct(main), top: '0%', height: '100%' } }]
  }

  if (mode === 3) {
    if (split3Style === 'top') {
      return [
        { key: 'main', axis: 'y', style: { left: '0%', top: pct(main), width: '100%' } },
        {
          key: 'cross',
          axis: 'x',
          style: { left: pct(cross), top: pct(main), height: pct(1 - main) },
        },
      ]
    }
    const onLeft = split3Style === 'left'
    return [
      {
        key: 'main',
        axis: 'x',
        style: { left: pct(onLeft ? main : 1 - main), top: '0%', height: '100%' },
      },
      {
        key: 'cross',
        axis: 'y',
        style: { left: onLeft ? pct(main) : '0%', top: pct(cross), width: pct(1 - main) },
      },
    ]
  }

  return []
}

/**
 * The ratio value a pointer at `position` px implies, given the container's `origin` and `size`.
 *
 * For the mirrored 3-pane layout (`right`) the main pane is measured from the *right* edge, so the
 * pointer fraction has to be inverted — without this the divider ran away from the cursor.
 */
export function fractionFromPointer(
  position: number,
  origin: number,
  size: number,
  invert = false,
): number {
  if (size <= 0) return 0.5
  const raw = (position - origin) / size
  return clampFraction(invert ? 1 - raw : raw)
}
