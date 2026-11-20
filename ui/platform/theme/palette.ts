import type { Rgba } from '../../ide/platform/cssColor'
import type { AppTheme, TerminalTheme, UITheme } from '../../themes'

import type { ThemeMode } from './choice'
import { blendOver, mixColors, opaqueHex, safeColor, safeOpaqueHex } from './themeColors'

/**
 * The tokens.css palette (`--palette-*`) an OmniTerm theme supplies. tokens.css derives every
 * workbench colour (title bar, stripes, tool windows, popups, status bar, editor and syntax colours,
 * terminal ANSI) from these roles under `[data-color-theme]`, so a theme that fills the palette
 * recolours the whole workbench consistently, exactly as Solarized or One Dark do.
 */

/** Value of `data-color-theme` while an OmniTerm theme is selected. */
export const OMNI_COLOR_THEME = 'omniterm'

const ANSI_NAMES = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const

/** `brightBlack` -> `bright-black`, the suffix of `--palette-ansi-*`. */
const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

const BLACK: Rgba = [0, 0, 0, 1]
const WHITE: Rgba = [255, 255, 255, 1]
const FALLBACK_BG: Record<ThemeMode, Rgba> = { dark: [26, 27, 38, 1], light: [250, 250, 250, 1] }

/** The theme's own colour (painted over `base`), or `fallback` when it is absent or not a colour. */
const pick = (value: unknown, base: Rgba, fallback: Rgba): Rgba => {
  const color = safeColor(value)
  return color ? blendOver(color, base) : fallback
}

/** The palette roles of `theme` in `mode`, as `--palette-*` name to `#rrggbb`. */
export function paletteFor(theme: AppTheme, mode: ThemeMode): Record<string, string> {
  const terminal: TerminalTheme = theme.terminal[mode] ?? theme.terminal.dark
  const ui: Partial<UITheme> = theme.ui?.[mode] ?? {}
  const bg = pick(terminal.background, BLACK, FALLBACK_BG[mode])
  const fg = pick(terminal.foreground, bg, mixColors(bg, mode === 'dark' ? WHITE : BLACK, 0.85))
  const ansi = (name: (typeof ANSI_NAMES)[number]): Rgba => pick(terminal[name], bg, fg)
  const towardsFg = (amount: number): Rgba => mixColors(bg, fg, amount)

  const panel = pick(ui.sidebarBg, bg, towardsFg(0.05))
  const muted = pick(ui.dimText, bg, ansi('brightBlack'))
  const accent = pick(ui.accent, bg, ansi('blue'))

  const roles: Record<string, Rgba> = {
    bg,
    panel,
    popup: pick(ui.popupBg, bg, panel),
    fg,
    muted,
    border: pick(ui.border, bg, towardsFg(0.14)),
    hover: pick(ui.hoverBg, bg, towardsFg(0.08)),
    selection: pick(terminal.selectionBackground, bg, towardsFg(0.18)),
    line: towardsFg(0.04),
    accent,
    'on-accent': pick(ui.accentFg, accent, bg),
    yellow: ansi('yellow'),
    orange: ansi('brightYellow'),
    red: ansi('red'),
    magenta: ansi('magenta'),
    violet: ansi('brightMagenta'),
    blue: ansi('blue'),
    cyan: ansi('cyan'),
    green: ansi('green'),
    keyword: ansi('magenta'),
    type: ansi('cyan'),
    number: ansi('yellow'),
    variable: ansi('blue'),
    property: ansi('brightCyan'),
    comment: muted,
  }
  const palette: Record<string, string> = {}
  for (const [role, color] of Object.entries(roles)) palette[`--palette-${role}`] = opaqueHex(color)
  for (const name of ANSI_NAMES) palette[`--palette-ansi-${kebab(name)}`] = opaqueHex(ansi(name))
  return palette
}

/** Status colours a theme names explicitly; the palette's red, yellow and green stand in otherwise. */
function statusOverrides(ui: Partial<UITheme>, bg: Rgba): Record<string, string> {
  const out: Record<string, string> = {}
  const pairs: Array<[string, unknown]> = [['--danger', ui.error], ['--warning', ui.warning], ['--success', ui.success]]
  for (const [name, value] of pairs) {
    const hex = safeOpaqueHex(value, bg)
    if (hex) out[name] = hex
  }
  return out
}

/**
 * The stylesheet that makes an OmniTerm theme the workbench theme: `:root[data-color-theme="omniterm"]`
 * only declares the palette, the rest of tokens.css follows from it. The extra `[data-theme]` lifts
 * it over the mode's own block. Every value is a re-serialised `#rrggbb`, never theme text.
 */
export function omniPaletteCss(theme: AppTheme, mode: ThemeMode): string {
  const ui: Partial<UITheme> = theme.ui?.[mode] ?? {}
  const bg = pick(theme.terminal[mode]?.background, BLACK, FALLBACK_BG[mode])
  const decls = { ...paletteFor(theme, mode), ...statusOverrides(ui, bg) }
  const body = Object.entries(decls).map(([name, value]) => `  ${name}: ${value};`)
  return `:root[data-color-theme="${OMNI_COLOR_THEME}"][data-theme] {\n  color-scheme: ${mode};\n${body.join('\n')}\n}\n`
}
