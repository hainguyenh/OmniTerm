import type { AppTheme, TerminalTheme, UITheme } from '../../themes'
import { TOKYO_NIGHT } from '../../themes'

import { WORKBENCH_THEME_ID, type ThemeMode } from './choice'

/** Reads a design token as `#rrggbb[aa]`; `null` when it has no usable value. */
export type TokenReader = (name: string) => string | null

const ANSI_TOKENS = {
  black: '--terminal-ansi-black',
  red: '--terminal-ansi-red',
  green: '--terminal-ansi-green',
  yellow: '--terminal-ansi-yellow',
  blue: '--terminal-ansi-blue',
  magenta: '--terminal-ansi-magenta',
  cyan: '--terminal-ansi-cyan',
  white: '--terminal-ansi-white',
  brightBlack: '--terminal-ansi-bright-black',
  brightRed: '--terminal-ansi-bright-red',
  brightGreen: '--terminal-ansi-bright-green',
  brightYellow: '--terminal-ansi-bright-yellow',
  brightBlue: '--terminal-ansi-bright-blue',
  brightMagenta: '--terminal-ansi-bright-magenta',
  brightCyan: '--terminal-ansi-bright-cyan',
  brightWhite: '--terminal-ansi-bright-white',
} as const

/**
 * The OmniTerm theme corresponding to the workbench theme in effect (Islands Light / Dark, High
 * Contrast, Solarized, One, a plugin's): terminals, sticky notes and OmniTerm panels paint from it,
 * so choosing one of the workbench's own themes recolours them too. The tokens are the single source;
 * this only restates them in OmniTerm's vocabulary.
 */
export function appThemeFromTokens(read: TokenReader, mode: ThemeMode): AppTheme {
  const baseUi = TOKYO_NIGHT.ui[mode]
  const fallback = TOKYO_NIGHT.terminal[mode]
  const token = (name: string, fallbackColor: string): string => read(name) ?? fallbackColor

  const background = token('--bg-app', fallback.background)
  const foreground = token('--fg', fallback.foreground)
  const terminal: TerminalTheme = {
    ...fallback,
    background,
    foreground,
    cursor: token('--caret', foreground),
    cursorAccent: background,
    selectionBackground: token('--bg-editor-selection', fallback.selectionBackground),
    selectionForeground: foreground,
  }
  for (const [key, name] of Object.entries(ANSI_TOKENS)) {
    const slot = key as keyof typeof ANSI_TOKENS
    terminal[slot] = token(name, terminal[slot])
  }
  // Light themes keep ANSI-black backgrounds readable by painting them as a soft grey.
  delete terminal.lightModeBlackBackground

  const ui: UITheme = {
    ...baseUi,
    sidebarBg: token('--bg-frame', baseUi.sidebarBg),
    popupBg: token('--bg-popup', baseUi.popupBg),
    accent: token('--accent', baseUi.accent),
    accentFg: token('--fg-on-accent', background),
    dimText: token('--fg-muted', baseUi.dimText),
    border: token('--border', baseUi.border),
    cardBg: token('--bg-elev', baseUi.cardBg),
    hoverBg: token('--bg-hover', baseUi.hoverBg ?? ''),
    selectionFg: foreground,
    warning: token('--warning', baseUi.warning ?? ''),
    error: token('--danger', baseUi.error ?? ''),
    success: token('--success', baseUi.success ?? ''),
  }
  return {
    id: WORKBENCH_THEME_ID,
    name: 'Workbench theme',
    terminal: { dark: terminal, light: terminal },
    ui: { dark: ui, light: ui },
  }
}
