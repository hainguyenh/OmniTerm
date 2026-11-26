/**
 * Draws a program's own 24-bit and 256-color foregrounds with the terminal scheme's ANSI colors.
 *
 * Agent CLIs (Claude Code, Codex, Copilot CLI) paint their UI with fixed RGB values, which no
 * terminal theme can recolor: their orange, purples and greys look the same under every scheme, and
 * often clash with it. Rewriting the color *parameters* of an SGR sequence they already sent to the
 * nearest ANSI slot (`38;2;215;119;87` → `33`) hands the choice back to the scheme. Nothing is
 * inserted between characters and no sequence is added or removed, so a TUI that positions text by
 * coordinate (which is why the output highlighter stays off for them) is drawn exactly as before,
 * only in the scheme's colors.
 *
 * Backgrounds are left alone: agents use soft RGB backgrounds for diffs and message blocks, and the
 * saturated ANSI backgrounds they would map to are unreadable behind text.
 */

/** Below this chroma (0–255) a color reads as grey, whatever its hue. */
const GREY_CHROMA = 40
/** At or above this lightness (0–1) a color takes the bright variant of its slot. */
const BRIGHT_LIGHTNESS = 0.6

/**
 * Upper hue bound (degrees, exclusive) of each ANSI hue family, in order. Orange joins yellow: red
 * is what errors use, and an agent's orange accent is not an error.
 */
const HUE_FAMILIES: readonly (readonly [number, number])[] = [
  [15, 1], // red
  [70, 3], // orange, yellow
  [170, 2], // green
  [200, 6], // cyan
  [260, 4], // blue
  [345, 5], // purple, magenta
  [360, 1], // red again
]

/**
 * The ANSI slot (0–15) of an RGB color, by hue family and lightness rather than distance to one
 * reference palette — a distance metric pulls an orange and a mid grey to the same muted slot, and
 * then the colors an agent uses to tell things apart all look alike.
 */
export function nearestAnsi(r: number, g: number, b: number): number {
  const high = Math.max(r, g, b)
  const low = Math.min(r, g, b)
  const lightness = (high + low) / 510
  if (high - low < GREY_CHROMA) return lightness >= BRIGHT_LIGHTNESS ? 7 : 8
  const chroma = high - low
  const hue = high === r
    ? (60 * ((g - b) / chroma) + 360) % 360
    : high === g
      ? 60 * ((b - r) / chroma) + 120
      : 60 * ((r - g) / chroma) + 240
  const slot = HUE_FAMILIES.find(([bound]) => hue < bound)?.[1] ?? 1
  return lightness >= BRIGHT_LIGHTNESS ? slot + 8 : slot
}

/** RGB of a 256-color index from the 6×6×6 cube or the grey ramp (16–255). */
function xterm256Rgb(index: number): [number, number, number] {
  if (index >= 232) {
    const level = 8 + (index - 232) * 10
    return [level, level, level]
  }
  const cube = index - 16
  const level = (step: number) => (step === 0 ? 0 : 55 + step * 40)
  return [level(Math.floor(cube / 36)), level(Math.floor(cube / 6) % 6), level(cube % 6)]
}

/** The SGR foreground parameter of ANSI slot `slot`: 30–37 or 90–97. */
const fgParam = (slot: number): string => String(slot < 8 ? 30 + slot : 90 + slot - 8)

/**
 * The foreground parameter for an RGB color. Near-white and near-black greys are an agent's body
 * text color for its own idea of dark or light mode; they become the scheme's default foreground
 * (`39`), which is readable on its background either way.
 */
export function fgForRgb(r: number, g: number, b: number): string {
  const high = Math.max(r, g, b)
  const low = Math.min(r, g, b)
  if (high - low < 24 && (low >= 230 || high <= 25)) return '39'
  return fgParam(nearestAnsi(r, g, b))
}

const byte = (value: string | undefined): number | null => {
  if (value === undefined || !/^\d{1,3}$/.test(value)) return null
  const n = Number(value)
  return n <= 255 ? n : null
}

/**
 * `seq` (one complete escape sequence) with its extended foreground colors mapped to ANSI slots.
 * Anything that is not a plain semicolon-separated SGR, or a color it cannot read, is returned as is.
 */
export function paletteSgr(seq: string): string {
  if (!seq.startsWith('\x1b[') || !seq.endsWith('m') || seq.length < 4) return seq
  const body = seq.slice(2, -1)
  if (!/^[\d;]*$/.test(body) || !body.includes('38;')) return seq
  const params = body.split(';')
  const out: string[] = []
  let changed = false
  for (let i = 0; i < params.length; i++) {
    const param = params[i]
    if (param === '48') {
      // A background color: copy it and its arguments untouched.
      const span = params[i + 1] === '5' ? 3 : params[i + 1] === '2' ? 5 : 1
      out.push(...params.slice(i, i + span))
      i += span - 1
      continue
    }
    if (param !== '38') {
      out.push(param ?? '')
      continue
    }
    if (params[i + 1] === '2') {
      const [r, g, b] = [byte(params[i + 2]), byte(params[i + 3]), byte(params[i + 4])]
      if (r === null || g === null || b === null) return seq
      out.push(fgForRgb(r, g, b))
      i += 4
      changed = true
    } else if (params[i + 1] === '5') {
      const index = byte(params[i + 2])
      if (index === null) return seq
      out.push(index < 16 ? fgParam(index) : fgForRgb(...xterm256Rgb(index)))
      i += 2
      changed = true
    } else {
      return seq
    }
  }
  return changed ? `\x1b[${out.join(';')}m` : seq
}
