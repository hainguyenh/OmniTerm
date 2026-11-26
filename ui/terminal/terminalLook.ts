import type { TerminalTheme } from '../themes'

import { CUSTOM_PREFIX, findColorScheme, FOLLOW_THEME, paletteOf, type TerminalColorScheme } from './colorSchemes'
import { parseItermColors } from './itermColors'

/**
 * How session terminals look (Settings › Terminal › Appearance), stored as one `terminalLook`
 * object in the app settings. The settings file is user-editable, so every field is validated on
 * read and anything missing or malformed falls back to the defaults below.
 */
export interface TerminalLookSettings {
  /** Scheme id while the app is dark: {@link FOLLOW_THEME}, a preset id, or an imported `custom:` id. */
  darkScheme: string
  /** Scheme id while the app is light. */
  lightScheme: string
  /**
   * xterm's minimum contrast ratio (1 = off … 7). `auto` keeps dark palettes untouched and corrects
   * light ones, where agent UIs draw pale colors over pale backgrounds.
   */
  minContrast: 'auto' | number
  /** Bold text in the 8 normal colors is drawn in their bright variants, like iTerm2. */
  boldBright: boolean
  /** Color and underline URLs and file paths in plain output. */
  linkColors: boolean
  /**
   * Programs' own 24-bit and 256-color text (agent CLIs paint their UI in fixed RGB) is drawn with
   * the scheme's ANSI colors, so it follows the theme. See `paletteSgr`.
   */
  themeColors: boolean
  /** Schemes imported from `.itermcolors` files. */
  customSchemes: TerminalColorScheme[]
}

export const DEFAULT_TERMINAL_LOOK: Readonly<TerminalLookSettings> = {
  darkScheme: FOLLOW_THEME,
  lightScheme: FOLLOW_THEME,
  minContrast: 'auto',
  boldBright: true,
  linkColors: true,
  themeColors: true,
  customSchemes: [],
}

export const MIN_CONTRAST_LIMITS = { min: 1, max: 7 } as const

/** Imported schemes kept at most; the settings file stays small. */
const MAX_CUSTOM_SCHEMES = 50

const HEX_RE = /^#[0-9a-f]{6}$/i

/** The 16 ANSI palette keys in index order. */
const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const

const record = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}

/** A stored palette; `null` unless the background, foreground and all 16 ANSI colors are valid. */
function parsePalette(raw: unknown): TerminalTheme | null {
  const source = record(raw)
  const hex = (key: string): string | null => {
    const value = source[key]
    return typeof value === 'string' && HEX_RE.test(value) ? value : null
  }
  const ansi = ANSI_KEYS.map(hex).filter((c): c is string => c !== null)
  const background = hex('background')
  const foreground = hex('foreground')
  if (!background || !foreground || ansi.length !== ANSI_KEYS.length) return null
  const base = {
    background,
    foreground,
    cursor: hex('cursor') ?? foreground,
    selection: hex('selectionBackground') ?? ansi[8] ?? foreground,
  }
  return {
    ...paletteOf(base, ansi),
    cursorAccent: hex('cursorAccent') ?? background,
    selectionForeground: hex('selectionForeground') ?? '',
  }
}

function parseCustomSchemes(raw: unknown): TerminalColorScheme[] {
  if (!Array.isArray(raw)) return []
  const out: TerminalColorScheme[] = []
  for (const item of raw) {
    const source = record(item)
    const { id, name } = source
    if (typeof id !== 'string' || !id.startsWith(CUSTOM_PREFIX) || typeof name !== 'string' || !name.trim()) continue
    if (out.some(s => s.id === id)) continue
    const colors = parsePalette(source.colors)
    if (colors) out.push({ id, name: name.trim().slice(0, 80), colors })
    if (out.length >= MAX_CUSTOM_SCHEMES) break
  }
  return out
}

export function parseTerminalLook(raw: unknown): TerminalLookSettings {
  const source = record(raw)
  const customSchemes = parseCustomSchemes(source.customSchemes)
  const schemeId = (value: unknown): string =>
    typeof value === 'string' && (value === FOLLOW_THEME || findColorScheme(value, customSchemes))
      ? value
      : FOLLOW_THEME
  const contrast = source.minContrast
  return {
    darkScheme: schemeId(source.darkScheme),
    lightScheme: schemeId(source.lightScheme),
    minContrast: typeof contrast === 'number' && Number.isFinite(contrast)
      ? Math.min(MIN_CONTRAST_LIMITS.max, Math.max(MIN_CONTRAST_LIMITS.min, contrast))
      : 'auto',
    boldBright: typeof source.boldBright === 'boolean' ? source.boldBright : DEFAULT_TERMINAL_LOOK.boldBright,
    linkColors: typeof source.linkColors === 'boolean' ? source.linkColors : DEFAULT_TERMINAL_LOOK.linkColors,
    themeColors: typeof source.themeColors === 'boolean' ? source.themeColors : DEFAULT_TERMINAL_LOOK.themeColors,
    customSchemes,
  }
}

/** Adds an imported scheme under a fresh `custom:` id, which the returned settings also select for `mode`. */
export function addCustomScheme(
  look: TerminalLookSettings,
  name: string,
  colors: TerminalTheme,
  mode: 'dark' | 'light',
): TerminalLookSettings {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scheme'
  let id = `${CUSTOM_PREFIX}${slug}`
  for (let n = 2; look.customSchemes.some(s => s.id === id); n++) id = `${CUSTOM_PREFIX}${slug}-${n}`
  const customSchemes = [...look.customSchemes, { id, name: name.trim() || 'Imported scheme', colors }]
    .slice(-MAX_CUSTOM_SCHEMES)
  return { ...look, customSchemes, ...(mode === 'dark' ? { darkScheme: id } : { lightScheme: id }) }
}

/** Removes an imported scheme; a mode that used it goes back to following the theme. */
export function removeCustomScheme(look: TerminalLookSettings, id: string): TerminalLookSettings {
  return {
    ...look,
    customSchemes: look.customSchemes.filter(s => s.id !== id),
    darkScheme: look.darkScheme === id ? FOLLOW_THEME : look.darkScheme,
    lightScheme: look.lightScheme === id ? FOLLOW_THEME : look.lightScheme,
  }
}

/** True when `hex` (#rrggbb) is a light background. */
export function isLightColor(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  if (!HEX_RE.test(hex) || Number.isNaN(n)) return false
  const [r, g, b] = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5
}

/** What a session pane is drawn with, after the user's look settings are applied to the theme. */
export interface ResolvedTerminalLook {
  theme: TerminalTheme | undefined
  /** The palette is a light one (drives xterm's light-mode repairs). */
  lightPalette: boolean
  minimumContrastRatio: number
  boldBright: boolean
  linkColors: boolean
  themeColors: boolean
}

export function resolveTerminalLook(
  raw: unknown,
  themePalette: TerminalTheme | undefined,
  darkMode: boolean,
): ResolvedTerminalLook {
  const look = parseTerminalLook(raw)
  const scheme = findColorScheme(darkMode ? look.darkScheme : look.lightScheme, look.customSchemes)
  const lightPalette = scheme ? isLightColor(scheme.colors.background) : !darkMode
  return {
    theme: scheme?.colors ?? themePalette,
    lightPalette,
    minimumContrastRatio: look.minContrast === 'auto' ? (lightPalette ? 2.5 : 1) : look.minContrast,
    boldBright: look.boldBright,
    linkColors: look.linkColors,
    themeColors: look.themeColors,
  }
}

/**
 * Adds the scheme of an `.itermcolors` file, named after the file, and selects it for the mode its
 * background suits. `null` when the file is not a usable color preset.
 */
export function importItermScheme(look: TerminalLookSettings, fileName: string, xml: string): TerminalLookSettings | null {
  const colors = parseItermColors(xml)
  if (!colors) return null
  const name = fileName.replace(/\.itermcolors$/i, '').trim()
  return addCustomScheme(look, name, colors, isLightColor(colors.background) ? 'light' : 'dark')
}
