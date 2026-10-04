/**
 * Index math for the virtualized CSV grid: which rows and columns intersect the viewport. Pure, so
 * the scroll handler does a couple of binary searches instead of touching every row.
 */

/** Half-open range `[start, end)` of fixed-height rows visible in the viewport, plus overscan. */
export function rowRange(scrollTop: number, viewportHeight: number, rowHeight: number, count: number, overscan = 8): [number, number] {
  if (count <= 0 || rowHeight <= 0) return [0, 0]
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight)
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / rowHeight)
  return [Math.max(0, first - overscan), Math.min(count, last + overscan)]
}

/** Running left edges: `prefix[i]` is where column `i` starts, `prefix[n]` the total width. */
export function prefixSums(widths: readonly number[]): number[] {
  const prefix = [0]
  for (const width of widths) prefix.push(prefix[prefix.length - 1] + width)
  return prefix
}

/** First index `i` with `prefix[i + 1] > offset` — the column containing `offset`. */
function columnAt(prefix: readonly number[], offset: number): number {
  let low = 0
  let high = prefix.length - 2
  while (low < high) {
    const mid = (low + high) >> 1
    if (prefix[mid + 1] > offset) high = mid
    else low = mid + 1
  }
  return Math.max(0, low)
}

/** Half-open range of variable-width columns visible between `scrollLeft` and `scrollLeft + width`. */
export function colRange(prefix: readonly number[], scrollLeft: number, viewportWidth: number, overscan = 2): [number, number] {
  const count = prefix.length - 1
  if (count <= 0) return [0, 0]
  const first = columnAt(prefix, Math.max(0, scrollLeft))
  const last = columnAt(prefix, Math.max(0, scrollLeft) + Math.max(0, viewportWidth))
  return [Math.max(0, first - overscan), Math.min(count, last + 1 + overscan)]
}
