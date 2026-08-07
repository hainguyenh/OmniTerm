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
  accentFg?: string
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

export type LayoutMode = 1 | 2 | 3 | 4 | 6 | 8

/** The built-in default is authored in JSON and is also used by frontend tests and safe fallbacks. */
export const TOKYO_NIGHT: AppTheme = tokyoNightTheme
export const DEFAULT_THEME_ID = TOKYO_NIGHT.id
