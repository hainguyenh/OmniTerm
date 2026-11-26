import type { TerminalTheme } from '../themes'

/**
 * Terminal color schemes that replace the app theme's terminal palette (Settings › Terminal ›
 * Appearance), like iTerm2's color presets. Palettes follow each scheme's published values.
 */
export interface TerminalColorScheme {
  id: string
  name: string
  colors: TerminalTheme
}

/** The scheme id meaning "use the app theme's own terminal palette". */
export const FOLLOW_THEME = 'theme'

/** Prefix of the ids of schemes imported from `.itermcolors` files. */
export const CUSTOM_PREFIX = 'custom:'

type Ansi16 = readonly [
  string, string, string, string, string, string, string, string,
  string, string, string, string, string, string, string, string,
]

export interface SchemeBase {
  background: string
  foreground: string
  cursor: string
  selection: string
}

/**
 * A full palette from the four base colors and the 16 ANSI colors in index order (`Ansi 0` …
 * `Ansi 15`); a missing ANSI entry falls back to the foreground.
 */
export const paletteOf = (base: SchemeBase, ansi: readonly string[]): TerminalTheme => {
  const at = (index: number): string => ansi[index] ?? base.foreground
  return {
    background: base.background,
    foreground: base.foreground,
    cursor: base.cursor,
    cursorAccent: base.background,
    selectionBackground: base.selection,
    selectionForeground: '',
    black: at(0),
    red: at(1),
    green: at(2),
    yellow: at(3),
    blue: at(4),
    magenta: at(5),
    cyan: at(6),
    white: at(7),
    brightBlack: at(8),
    brightRed: at(9),
    brightGreen: at(10),
    brightYellow: at(11),
    brightBlue: at(12),
    brightMagenta: at(13),
    brightCyan: at(14),
    brightWhite: at(15),
  }
}

const scheme = (id: string, name: string, base: SchemeBase, ansi: Ansi16): TerminalColorScheme => ({
  id,
  name,
  colors: paletteOf(base, ansi),
})

export const COLOR_SCHEMES: readonly TerminalColorScheme[] = [
  scheme('iterm2-default', 'iTerm2 Default', {
    background: '#000000', foreground: '#c7c7c7', cursor: '#c7c7c7', selection: '#3a4a64',
  }, [
    '#000000', '#c91b00', '#00c200', '#c7c400', '#2a5bf0', '#ca30c7', '#00c5c7', '#c7c7c7',
    '#686868', '#ff6e67', '#5ffa68', '#fffc67', '#6871ff', '#ff77ff', '#60fdff', '#ffffff',
  ]),
  scheme('one-half-dark', 'One Half Dark', {
    background: '#282c34', foreground: '#dcdfe4', cursor: '#a3b3cc', selection: '#3e4451',
  }, [
    '#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#dcdfe4',
    '#5a6374', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff',
  ]),
  scheme('dracula', 'Dracula', {
    background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selection: '#44475a',
  }, [
    '#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
    '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff',
  ]),
  scheme('tokyo-night', 'Tokyo Night', {
    background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', selection: '#33467c',
  }, [
    '#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
    '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5',
  ]),
  scheme('catppuccin-mocha', 'Catppuccin Mocha', {
    background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', selection: '#585b70',
  }, [
    '#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de',
    '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8',
  ]),
  scheme('gruvbox-dark', 'Gruvbox Dark', {
    background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', selection: '#504945',
  }, [
    '#3c3836', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984',
    '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2',
  ]),
  scheme('nord', 'Nord', {
    background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selection: '#434c5e',
  }, [
    '#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
    '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4',
  ]),
  scheme('monokai', 'Monokai', {
    background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f0', selection: '#49483e',
  }, [
    '#3e3d32', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f8f8f2',
    '#75715e', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f9f8f5',
  ]),
  scheme('solarized-dark', 'Solarized Dark', {
    background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selection: '#073642',
  }, [
    '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
    '#586e75', '#cb4b16', '#93a1a1', '#b58900', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3',
  ]),
  scheme('one-half-light', 'One Half Light', {
    background: '#fafafa', foreground: '#383a42', cursor: '#4f525d', selection: '#bfceff',
  }, [
    '#383a42', '#e45649', '#50a14f', '#c18401', '#0184bc', '#a626a4', '#0997b3', '#a0a1a7',
    '#4f525d', '#df6c75', '#3e953a', '#a37500', '#2f8de0', '#b553b3', '#1e8aa0', '#696c77',
  ]),
  scheme('solarized-light', 'Solarized Light', {
    background: '#fdf6e3', foreground: '#657b83', cursor: '#586e75', selection: '#eee8d5',
  }, [
    '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#93a1a1',
    '#586e75', '#cb4b16', '#657b83', '#a07800', '#586e75', '#6c71c4', '#1f8a82', '#002b36',
  ]),
]

/** A preset or an imported scheme by id; `undefined` for {@link FOLLOW_THEME} or an unknown id. */
export function findColorScheme(
  id: string,
  custom: readonly TerminalColorScheme[] = [],
): TerminalColorScheme | undefined {
  if (id === FOLLOW_THEME) return undefined
  return id.startsWith(CUSTOM_PREFIX)
    ? custom.find(s => s.id === id)
    : COLOR_SCHEMES.find(s => s.id === id)
}
