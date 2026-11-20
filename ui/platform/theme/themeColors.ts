import { parseColor, toHex, type Rgba } from '../../ide/platform/cssColor'

/**
 * Colour handling for theme values that come from outside the app (theme files on disk, imported
 * settings). Nothing from such a file is ever written into CSS verbatim: a value is parsed into
 * numbers and re-serialised as `#rrggbb`, so a theme cannot smuggle a declaration, a selector or a
 * `url()` into the stylesheet the palette is injected through.
 */

/** Longest colour string considered; real colours are far shorter, so anything longer is hostile. */
const MAX_COLOR_LENGTH = 64

const inRange = (n: number, min: number, max: number): boolean => Number.isFinite(n) && n >= min && n <= max

/** The colour a theme value names, or `null` when it is not a plain `#hex`, `rgb()` or `rgba()` colour. */
export function safeColor(value: unknown): Rgba | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_COLOR_LENGTH) return null
  const color = parseColor(value)
  if (!color) return null
  const [r, g, b, a] = color
  return inRange(r, 0, 255) && inRange(g, 0, 255) && inRange(b, 0, 255) && inRange(a, 0, 1) ? color : null
}

/** `top` painted over the opaque `base`. */
export function blendOver(top: Rgba, base: Rgba): Rgba {
  const a = top[3]
  return [top[0] * a + base[0] * (1 - a), top[1] * a + base[1] * (1 - a), top[2] * a + base[2] * (1 - a), 1]
}

/** `from` moved `amount` (0-1) of the way towards `to`, opaque. */
export function mixColors(from: Rgba, to: Rgba, amount: number): Rgba {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
    1,
  ]
}

/** An opaque `#rrggbb` for a theme value painted over `base`, or `null` when the value is not a colour. */
export function safeOpaqueHex(value: unknown, base: Rgba): string | null {
  const color = safeColor(value)
  return color ? toHex(blendOver(color, base)) : null
}

/** An opaque `#rrggbb` for a colour already validated. */
export const opaqueHex = (color: Rgba): string => toHex([color[0], color[1], color[2], 1])
