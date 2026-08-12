/**
 * paneLayout.ts — where each pane sits, and where its dividers are
 *
 * Panes are absolutely positioned with percentage rects rather than a CSS grid, which is what makes
 * them draggable: the split positions are plain numbers in state, so a divider drag is one setState.
 *
 * The 2- and 3-pane layouts keep their legacy `main`/`cross` ratios. Dense grids also retain their
 * divider positions as normalized cumulative boundaries, so every multi-pane layout can be tuned.
 */

import type { CSSProperties } from 'react'
import type { LayoutMode } from './themes'

/** Where the adjustable splits sit, as fractions of the pane area. */
export interface SplitRatios {
  /** The primary split: the boundary between pane 0 and the rest. */
  main: number
  /** The secondary split: where the two stacked panes of a 3-pane layout meet. */
  cross: number
  /** Cumulative vertical boundaries for the 4/6/8-pane grids. */
  columns?: number[]
  /** Cumulative horizontal boundaries for the 4/6/8-pane grids. */
  rows?: number[]
}

export type PaneDividerKey = 'main' | 'cross' | `column-${number}` | `row-${number}`

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
  const normalized: SplitRatios = {
    main: clampFraction(saved?.main ?? DEFAULT_RATIOS.main),
    cross: clampFraction(saved?.cross ?? DEFAULT_RATIOS.cross),
  }
  const columns = normalizeBoundaries(saved?.columns)
  const rows = normalizeBoundaries(saved?.rows)
  if (columns) normalized.columns = columns
  if (rows) normalized.rows = rows
  return normalized
}

function normalizeBoundaries(saved: unknown): number[] | undefined {
  if (!Array.isArray(saved) || saved.length < 1 || saved.length > 3) return undefined
  const count = saved.length + 1
  const result: number[] = []
  for (let index = 0; index < saved.length; index += 1) {
    const value = typeof saved[index] === 'number' ? saved[index] : Number.NaN
    const lower = (result[index - 1] ?? 0) + MIN_FRACTION
    const upper = 1 - MIN_FRACTION * (count - index - 1)
    if (!Number.isFinite(value)) return undefined
    result.push(Math.min(upper, Math.max(lower, value)))
  }
  return result
}

function gridColumnCount(mode: LayoutMode): number {
  return mode === 4 ? 2 : mode === 6 ? 3 : 4
}

function evenBoundaries(count: number): number[] {
  return Array.from({ length: count - 1 }, (_, index) => (index + 1) / count)
}

export function gridBoundaries(mode: LayoutMode, ratios: SplitRatios): { columns: number[]; rows: number[] } {
  const columnsCount = gridColumnCount(mode)
  const columns = normalizeBoundaries(ratios.columns)?.length === columnsCount - 1
    ? normalizeBoundaries(ratios.columns)!
    : evenBoundaries(columnsCount)
  const rows = normalizeBoundaries(ratios.rows)?.length === 1
    ? normalizeBoundaries(ratios.rows)!
    : [0.5]
  return { columns, rows }
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

  const { columns, rows } = gridBoundaries(mode, ratios)
  const columnCount = columns.length + 1
  const row = Math.floor(i / columnCount)
  const column = i % columnCount
  const left = column === 0 ? 0 : columns[column - 1]
  const right = columns[column] ?? 1
  const top = row === 0 ? 0 : rows[row - 1]
  const bottom = rows[row] ?? 1
  return { left: pct(left), top: pct(top), width: pct(right - left), height: pct(bottom - top) }
}

/** A draggable boundary: which ratio it moves, which way it moves, and where to draw it. */
export interface PaneDivider {
  key: PaneDividerKey
  axis: 'x' | 'y'
  minFraction?: number
  maxFraction?: number
  /** Position and extent of the *track* the handle is drawn on, as CSS percentages. */
  style: CSSProperties
}

/**
 * The dividers for `mode`, or an empty list when the layout is not adjustable.
 *
 * `main` is the outer boundary in the 2/3-pane layouts; `cross` splits the stacked pair, so its track
 * spans only that pair's half of the area. Grid dividers span the full pane area.
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

  if (mode === 1) return []

  const { columns, rows } = gridBoundaries(mode, ratios)
  const dividers: PaneDivider[] = columns.map((position, index) => ({
    key: `column-${index + 1}` as PaneDividerKey,
    axis: 'x',
    style: { left: pct(position), top: '0%', height: '100%' },
    minFraction: boundaryMin(columns, index),
    maxFraction: boundaryMax(columns, index),
  }))
  rows.forEach((position, index) => {
    dividers.push({
      key: `row-${index + 1}` as PaneDividerKey,
      axis: 'y',
      style: { left: '0%', top: pct(position), width: '100%' },
      minFraction: boundaryMin(rows, index),
      maxFraction: boundaryMax(rows, index),
    })
  })
  return dividers
}

function boundaryMin(boundaries: number[], index: number): number {
  return (boundaries[index - 1] ?? 0) + MIN_FRACTION
}

function boundaryMax(boundaries: number[], index: number): number {
  return (boundaries[index + 1] ?? 1) - MIN_FRACTION
}

export function setDividerRatio(
  ratios: SplitRatios,
  mode: LayoutMode,
  key: PaneDividerKey,
  value: number,
): SplitRatios {
  if (key === 'main' || key === 'cross') return { ...ratios, [key]: value }
  const { columns, rows } = gridBoundaries(mode, ratios)
  const target = key.startsWith('column-') ? columns : rows
  const index = Number(key.slice(key.indexOf('-') + 1)) - 1
  if (!Number.isInteger(index) || index < 0 || index >= target.length) return ratios
  const next = [...target]
  next[index] = Math.min(boundaryMax(target, index), Math.max(boundaryMin(target, index), value))
  return key.startsWith('column-') ? { ...ratios, columns: next } : { ...ratios, rows: next }
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
  minimum = MIN_FRACTION,
  maximum = 1 - MIN_FRACTION,
): number {
  if (size <= 0) return 0.5
  const raw = (position - origin) / size
  const fraction = invert ? 1 - raw : raw
  return Math.min(maximum, Math.max(minimum, fraction))
}

/**
 * The pane index carried by a drop, or null when the drop did not come from a pane header.
 *
 * `Number('')` is 0, not NaN, so parsing the payload directly meant any *other* drop onto a pane —
 * a file, a text selection, a link — read as "pane 0" and silently swapped it with the drop target.
 * That was unreachable while the webview's own drag-drop handler ate these events; disabling it so
 * pane reordering works is exactly what makes foreign drops reach the page.
 */
export function draggedPaneIndex(payload: string, paneCount: number): number | null {
  if (!/^\d+$/.test(payload)) return null
  const index = Number(payload)
  return index < paneCount ? index : null
}
