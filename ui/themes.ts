import tokyoNightTheme from '../src-tauri/builtinThemes/tokyoNight.json'

export interface TerminalTheme {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  selectionForeground: string
  black: string
  /** Optional light-mode replacement for ANSI black background cells. */
  lightModeBlackBackground?: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface UITheme {
  fontFamily: string
  fontFamilyMono?: string
  borderRadiusSm: string
  borderRadiusMd: string
  borderRadiusLg: string
  borderRadiusXl: string
  paddingSm: string
  paddingMd: string
  paddingLg: string
  paddingXl: string
  marginSm: string
  marginMd: string
  marginLg: string
  marginXl: string
  sidebarBg: string
  popupBg: string
  accent: string
  dimText: string
  border: string
  cardBg: string
  /* ── Optional colours ──────────────────────────────────────────────────────────────────────
   * Absent from a theme means "use the app default" (see themeCssVars in utils/themeVars.ts), which
   * is what these were before they became themeable. Every theme JSON written against the older
   * schema therefore keeps rendering exactly as it did. */
  /** Text drawn on top of `accent`. Defaults to the app background. */
  accentFg?: string
  /** Row/icon hover fill. Defaults to a translucent white (dark) or black (light). */
  hoverBg?: string
  /** Text colour inside a selection. Defaults to white (dark) or the foreground (light). */
  selectionFg?: string
  /** Scrim painted behind a modal. Defaults to a translucent slate. */
  overlay?: string
  warning?: string
  error?: string
  success?: string
}

export interface AppTheme {
  id: string
  name: string
  terminal: {
    dark: TerminalTheme
    light: TerminalTheme
  }
  ui: {
    dark: UITheme
    light: UITheme
  }
}

/** Pane-layout column counts. Single source for both the type and runtime validation. */
export const LAYOUT_MODES = [1, 2, 3, 4, 6, 8] as const

export type LayoutMode = (typeof LAYOUT_MODES)[number]

/** The built-in default is authored in JSON and is also used by frontend tests and safe fallbacks. */
export const TOKYO_NIGHT: AppTheme = tokyoNightTheme
export const DEFAULT_THEME_ID = TOKYO_NIGHT.id
