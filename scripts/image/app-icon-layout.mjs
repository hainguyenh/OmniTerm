/** Small Windows icons use the full logo composition matching v0.1.0. */
export const SMALL_ICON_MAX_SIZE = 0

const REFERENCE_SIZE = 1024
const COMPACT_CROP = Object.freeze({ left: 70, top: 350, width: 720, height: 550 })

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`)
  return value
}

/**
 * Select the source composition used for one generated icon size.
 * Uses full logo for all icon sizes to preserve original logo appearance and quality.
 */
export function iconSourceLayout(iconSize, sourceSize) {
  positiveInteger(iconSize, 'iconSize')
  positiveInteger(sourceSize, 'sourceSize')
  if (iconSize > SMALL_ICON_MAX_SIZE) return { kind: 'full' }

  const scale = sourceSize / REFERENCE_SIZE
  const extract = {
    left: Math.round(COMPACT_CROP.left * scale),
    top: Math.round(COMPACT_CROP.top * scale),
    width: Math.round(COMPACT_CROP.width * scale),
    height: Math.round(COMPACT_CROP.height * scale),
  }
  const verticalPadding = Math.max(0, extract.width - extract.height)
  const top = Math.floor(verticalPadding / 2)
  return {
    kind: 'compact',
    extract,
    extend: { top, bottom: verticalPadding - top, left: 0, right: 0 },
  }
}

