import type { ITheme } from '@xterm/xterm'
import type { TerminalTheme } from '../themes'

/**
 * Repair an app theme's colors before handing them to xterm.
 *
 * Theme JSON is loaded from `src-tauri/builtinThemes/*.json` (and user-authored files) with no
 * schema validation on the backend (`src-tauri/src/themes.rs`), and the old conversion
 * (`toXtermTheme`) only ever stripped an empty `selectionForeground` — any other malformed or
 * invisible color reached xterm untouched. Two shipped themes hit exactly that: `claude.json`'s
 * dark palette has `brightWhite === background`, and `clickhouse.json`'s dark palette has a `black`
 * only barely lighter than its `background`. Both are fixed at the source (see the JSON files), but
 * this is the general-purpose backstop for any theme — built-in or user-authored — that ships or
 * develops the same problem.
 */

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

const isValidHex = (v: string | undefined): v is string => !!v && HEX_RE.test(v)

/** Expand 3/4-digit shorthand to 6/8-digit, uppercase-agnostic. Caller has already validated the format. */
const expandHex = (hex: string): string => {
  const body = hex.slice(1)
  if (body.length === 3 || body.length === 4) {
    return '#' + body.split('').map(c => c + c).join('')
  }
  return hex.toLowerCase()
}

interface Rgb { r: number; g: number; b: number }

const hexToRgb = (hex: string): Rgb => {
  const full = expandHex(hex)
  return {
    r: parseInt(full.slice(1, 3), 16),
    g: parseInt(full.slice(3, 5), 16),
    b: parseInt(full.slice(5, 7), 16),
  }
}

const rgbToHex = ({ r, g, b }: Rgb): string =>
  '#' + [r, g, b].map(c => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')

/** WCAG relative luminance, 0 (black) to 1 (white). */
const relativeLuminance = ({ r, g, b }: Rgb): number => {
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio, always >= 1. */
const contrastRatio = (l1: number, l2: number): number => {
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (lighter + 0.05) / (darker + 0.05)
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

const rgbToHsl = ({ r, g, b }: Rgb): { h: number; s: number; l: number } => {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

const hslToRgb = ({ h, s, l }: { h: number; s: number; l: number }): Rgb => {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

/** Contrast below this is treated as effectively invisible and worth repairing. */
const MIN_ACCEPTABLE_RATIO = 1.6
/** Target ratio a repair aims for — high enough to read, low enough to keep the theme's hue. */
const REPAIR_TARGET_RATIO = 2.5
const LIGHTNESS_STEP = 0.05
const MAX_STEPS = 20
/** Fallback for older/user themes that do not define a light-mode ANSI black background. */
const LIGHT_MODE_BLACK_MIN_LIGHTNESS = 0.28
const FALLBACK_BACKGROUND = '#000000'
const FALLBACK_FOREGROUND = '#ffffff'

/**
 * If `hex` doesn't clear a minimal contrast ratio against `backgroundHex`, nudge its HSL lightness
 * away from the background's until it does — a repair, not a rejection, so the color stays
 * recognizably "the same color", just no longer invisible. `hex` is returned unchanged when it
 * already contrasts enough.
 */
const repairAgainstBackground = (hex: string, backgroundHex: string): string => {
  const bgLum = relativeLuminance(hexToRgb(backgroundHex))
  const rgb = hexToRgb(hex)
  if (contrastRatio(relativeLuminance(rgb), bgLum) >= MIN_ACCEPTABLE_RATIO) return hex

  const hsl = rgbToHsl(rgb)
  // A dark background needs a lighter color pushed away from it, and vice versa.
  const direction = bgLum < 0.5 ? 1 : -1
  let steps = 0
  while (steps < MAX_STEPS) {
    hsl.l = clamp01(hsl.l + direction * LIGHTNESS_STEP)
    const candidateLum = relativeLuminance(hslToRgb(hsl))
    if (contrastRatio(candidateLum, bgLum) >= REPAIR_TARGET_RATIO) break
    if (hsl.l === 0 || hsl.l === 1) break // hit the end of the lightness range — best we can do
    steps++
  }
  return rgbToHex(hslToRgb(hsl))
}

const softenLightModeBlack = (hex: string): string => {
  const hsl = rgbToHsl(hexToRgb(hex))
  if (hsl.l >= LIGHT_MODE_BLACK_MIN_LIGHTNESS) return hex
  hsl.l = LIGHT_MODE_BLACK_MIN_LIGHTNESS
  return rgbToHex(hslToRgb(hsl))
}

type XtermColorKey = Exclude<keyof TerminalTheme, 'lightModeBlackBackground'>

const COLOR_KEYS: readonly XtermColorKey[] = [
  'foreground', 'cursor', 'cursorAccent',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
  'brightMagenta', 'brightCyan', 'brightWhite',
]

/**
 * Convert an app `TerminalTheme` into the `ITheme` xterm accepts, dropping invalid colors and
 * repairing any that would be effectively invisible against the background.
 */
export const normalizeXtermTheme = (t: TerminalTheme, lightMode = false): ITheme => {
  const background = isValidHex(t.background) ? t.background : FALLBACK_BACKGROUND
  const out: ITheme = { background }

  for (const key of COLOR_KEYS) {
    const value = t[key]
    if (!isValidHex(value)) continue
    const adjusted = lightMode && key === 'black'
      ? (isValidHex(t.lightModeBlackBackground) ? t.lightModeBlackBackground : softenLightModeBlack(value))
      : value
    out[key] = repairAgainstBackground(adjusted, background)
  }

  // selectionBackground/selectionForeground are drawn over the background, not on it — repairing
  // them against `background` would be the wrong comparison, so they only get the validity check.
  if (isValidHex(t.selectionBackground)) out.selectionBackground = t.selectionBackground
  if (isValidHex(t.selectionForeground)) out.selectionForeground = t.selectionForeground

  // xterm needs a cursor to draw one at all; without a valid one, fall back to the (already
  // repaired) foreground so the cursor is never simply missing.
  if (!out.cursor) out.cursor = out.foreground ?? FALLBACK_FOREGROUND
  if (!out.cursorAccent) out.cursorAccent = background

  // The cursor and the text drawn on top of it (cursorAccent) must contrast with EACH OTHER, not
  // with the pane background — a repair against the wrong reference would fix nothing here.
  out.cursorAccent = repairAgainstBackground(out.cursorAccent, out.cursor)

  return out
}
