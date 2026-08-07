import type { AppTheme, TerminalTheme, UITheme } from '../themes'

/**
 * The one place that turns an `AppTheme` into the CSS custom properties the app paints with.
 *
 * Two consumers depend on it being the only such place: `App.tsx` writes the result onto
 * `document.documentElement`, and the Theme Remix preview writes the same record onto a wrapper
 * `<div>`. A preview built from its own mapping would drift from the real chrome the moment either
 * side changed, and drift is exactly what a preview exists to rule out.
 */

export type ThemeMode = 'dark' | 'light'

export const DEFAULT_SANS_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif'
export const DEFAULT_MONO_STACK =
  '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, Menlo, Monaco, "Courier New", monospace'

/** Fallbacks for the colours that used to be hardcoded, kept identical to what shipped before. */
const HOVER_DARK = 'rgba(255, 255, 255, 0.08)'
const HOVER_LIGHT = 'rgba(0, 0, 0, 0.06)'
const OVERLAY_DARK = 'rgba(15, 23, 42, 0.58)'
const OVERLAY_LIGHT = 'rgba(71, 85, 105, 0.28)'
const WARNING_FALLBACK = '#e0af68'
const ERROR_FALLBACK = '#f7768e'
const SUCCESS_FALLBACK = '#9ece6a'

/** Perceived-brightness test (ITU-R BT.601 luma), tolerant of `#rgb` and `#rrggbb`. */
export const isColorLight = (hex: string): boolean => {
  if (!hex || !hex.startsWith('#')) return false
  const body = hex.slice(1)
  const expand = (i: number) =>
    body.length === 3
      ? parseInt(body[i] + body[i], 16)
      : body.length >= 6
        ? parseInt(body.slice(i * 2, i * 2 + 2), 16)
        : NaN
  const [r, g, b] = [expand(0), expand(1), expand(2)]
  if ([r, g, b].some(Number.isNaN)) return false
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5
}

/**
 * The accent a theme gets when its `ui` block is missing entirely — a few hand-written themes predate
 * that block, and the app still has to look deliberate rather than defaulting everything to blue.
 */
const legacyAccent = (theme: AppTheme, terminal: TerminalTheme): string => {
  if (theme.id === 'tokyo-night') return '#7aa2f7'
  if (theme.id === 'mac-homebrew') return '#28FE14'
  if (theme.id === 'mac-novel') return '#A05A00'
  return terminal.blue || terminal.green || terminal.cyan
}

const legacyVars = (theme: AppTheme, terminal: TerminalTheme): Record<string, string> => {
  const isLight =
    theme.id.includes('novel') || (terminal.background.startsWith('#') && isColorLight(terminal.background))
  return {
    '--theme-accent': legacyAccent(theme, terminal),
    '--theme-accent-fg': 'var(--theme-bg)',
    '--theme-sidebar-bg': isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(0, 0, 0, 0.25)',
    '--theme-popup-bg': isLight ? '#f2eed9' : '#24283b',
    '--theme-dim': isLight ? '#73635A' : '#565f89',
    '--theme-card-bg': terminal.background,
    '--theme-font-family': DEFAULT_SANS_STACK,
    '--theme-font-mono': DEFAULT_MONO_STACK,
  }
}

/** Drop the keys a half-filled `ui` block leaves undefined, so they fall through to the defaults. */
const defined = (vars: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(vars).filter(([, value]) => typeof value === 'string')) as Record<string, string>

const uiVars = (ui: UITheme, mode: ThemeMode): Record<string, string> => ({
  '--theme-font-family': ui.fontFamily,
  '--theme-font-mono': ui.fontFamilyMono || DEFAULT_MONO_STACK,
  '--theme-rounded-sm': ui.borderRadiusSm,
  '--theme-rounded-md': ui.borderRadiusMd,
  '--theme-rounded-lg': ui.borderRadiusLg,
  '--theme-rounded-xl': ui.borderRadiusXl,
  '--theme-padding-sm': ui.paddingSm,
  '--theme-padding-md': ui.paddingMd,
  '--theme-padding-lg': ui.paddingLg,
  '--theme-padding-xl': ui.paddingXl,
  '--theme-margin-sm': ui.marginSm,
  '--theme-margin-md': ui.marginMd,
  '--theme-margin-lg': ui.marginLg,
  '--theme-margin-xl': ui.marginXl,
  '--theme-sidebar-bg': ui.sidebarBg,
  '--theme-popup-bg': ui.popupBg,
  '--theme-accent': ui.accent,
  '--theme-accent-fg': ui.accentFg || 'var(--theme-bg)',
  '--theme-dim': ui.dimText,
  '--theme-card-bg': ui.cardBg,
  '--theme-hover-bg': ui.hoverBg || (mode === 'dark' ? HOVER_DARK : HOVER_LIGHT),
  '--theme-overlay': ui.overlay || (mode === 'dark' ? OVERLAY_DARK : OVERLAY_LIGHT),
  '--theme-warning': ui.warning || WARNING_FALLBACK,
  '--theme-error': ui.error || ERROR_FALLBACK,
  '--theme-success': ui.success || SUCCESS_FALLBACK,
})

/**
 * Every CSS variable the app reads, resolved for one theme in one appearance mode.
 *
 * The optional `ui` colours (hover, overlay, selection foreground, warning/error/success) fall back to
 * the values that were hardcoded before they became themeable, so a theme JSON written against the old
 * schema renders exactly as it used to.
 */
export const themeCssVars = (theme: AppTheme, mode: ThemeMode): Record<string, string> => {
  const isDark = mode === 'dark'
  const terminal = isDark ? theme.terminal.dark : theme.terminal.light
  const ui: UITheme | undefined = isDark ? theme.ui?.dark : theme.ui?.light

  return {
    '--theme-bg': terminal.background,
    '--theme-fg': terminal.foreground,
    '--theme-border': ui?.border || terminal.brightBlack || terminal.selectionBackground,
    '--theme-selection': terminal.selectionBackground,
    '--theme-selection-fg': ui?.selectionFg || (isDark ? '#ffffff' : terminal.foreground),
    '--theme-hover-bg': isDark ? HOVER_DARK : HOVER_LIGHT,
    '--theme-overlay': isDark ? OVERLAY_DARK : OVERLAY_LIGHT,
    '--theme-warning': WARNING_FALLBACK,
    '--theme-error': ERROR_FALLBACK,
    '--theme-success': SUCCESS_FALLBACK,
    // A `ui` block the editor has only partially filled in (setting one colour on a theme that had no
    // block at all) must not blank out every other variable, so the legacy values stay underneath and
    // only the keys the theme actually defines are layered on top.
    ...legacyVars(theme, terminal),
    ...(ui ? defined(uiVars(ui, mode)) : {}),
  }
}

/** Apply a variable record to an element — `document.documentElement` in the app, a wrapper in previews. */
export const applyThemeVars = (element: HTMLElement, vars: Record<string, string>): void => {
  for (const [name, value] of Object.entries(vars)) element.style.setProperty(name, value)
}

/* ── The editable-field registry the Theme Remix editor renders from ──────────────────────── */

export interface ColorField {
  /** Key within `theme.ui[mode]` or `theme.terminal[mode]`. */
  key: string
  label: string
  /** Which half of the theme the value lives in. */
  source: 'ui' | 'terminal'
  /** What the colour paints, shown as the field's hint. */
  hint: string
}

/** App chrome colours, in the order they read as a palette rather than as a struct dump. */
export const APP_COLOR_FIELDS: readonly ColorField[] = [
  { key: 'background', source: 'terminal', label: 'App background', hint: 'Window and terminal canvas' },
  { key: 'foreground', source: 'terminal', label: 'Primary text', hint: 'Body and terminal text' },
  { key: 'sidebarBg', source: 'ui', label: 'Sidebar fill', hint: 'Activity bar and side panel' },
  { key: 'popupBg', source: 'ui', label: 'Popup fill', hint: 'Modals, menus, dropdowns' },
  { key: 'cardBg', source: 'ui', label: 'Card fill', hint: 'Cards, form rows, inputs' },
  { key: 'border', source: 'ui', label: 'Borders', hint: 'Dividers and outlines' },
  { key: 'accent', source: 'ui', label: 'Accent', hint: 'Primary buttons, active state' },
  { key: 'accentFg', source: 'ui', label: 'Accent text', hint: 'Text drawn on the accent' },
  { key: 'dimText', source: 'ui', label: 'Muted text', hint: 'Labels, hints, inactive tabs' },
  { key: 'hoverBg', source: 'ui', label: 'Hover fill', hint: 'Row and icon hover' },
  { key: 'selectionBackground', source: 'terminal', label: 'Selection fill', hint: 'Selected text background' },
  { key: 'selectionFg', source: 'ui', label: 'Selection text', hint: 'Text inside a selection' },
  { key: 'overlay', source: 'ui', label: 'Modal overlay', hint: 'Scrim behind a dialog' },
  { key: 'warning', source: 'ui', label: 'Warning', hint: 'Warning badges and text' },
  { key: 'error', source: 'ui', label: 'Error', hint: 'Errors and destructive actions' },
  { key: 'success', source: 'ui', label: 'Success', hint: 'Success badges, connected state' },
]

/** The terminal-only colours: the cursor pair, then the 16 ANSI slots. */
export const TERMINAL_COLOR_FIELDS: readonly ColorField[] = [
  { key: 'cursor', source: 'terminal', label: 'Cursor', hint: 'Block cursor fill' },
  { key: 'cursorAccent', source: 'terminal', label: 'Cursor text', hint: 'Glyph under the cursor' },
  ...([
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
    'brightMagenta', 'brightCyan', 'brightWhite',
  ] as const).map((key): ColorField => ({
    key,
    source: 'terminal',
    label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
    hint: 'ANSI palette slot',
  })),
]

/** Only meaningful in light mode: what ANSI-black *backgrounds* become so text stays readable. */
export const LIGHT_ONLY_TERMINAL_FIELD: ColorField = {
  key: 'lightModeBlackBackground',
  source: 'terminal',
  label: 'Black background (light mode)',
  hint: 'Replaces ANSI black behind text',
}

/** Read a field's current value out of a theme, whichever half it lives in. */
export const readColorField = (theme: AppTheme, mode: ThemeMode, field: ColorField): string => {
  const bag = (field.source === 'ui' ? theme.ui?.[mode] : theme.terminal[mode]) as unknown as
    | Record<string, unknown>
    | undefined
  const value = bag?.[field.key]
  return typeof value === 'string' ? value : ''
}

/**
 * The colour a field falls back to when the theme does not define it, so the swatch shows what the app
 * actually paints instead of an empty (black) input.
 */
export const resolvedColorField = (theme: AppTheme, mode: ThemeMode, field: ColorField): string => {
  const explicit = readColorField(theme, mode, field)
  if (explicit) return explicit
  const vars = themeCssVars(theme, mode)
  const fallback: Record<string, string> = {
    accentFg: vars['--theme-bg'],
    hoverBg: vars['--theme-hover-bg'],
    selectionFg: vars['--theme-selection-fg'],
    overlay: vars['--theme-overlay'],
    warning: vars['--theme-warning'],
    error: vars['--theme-error'],
    success: vars['--theme-success'],
    lightModeBlackBackground: readColorField(theme, mode, { ...field, key: 'black' }),
  }
  return fallback[field.key] ?? '#000000'
}
