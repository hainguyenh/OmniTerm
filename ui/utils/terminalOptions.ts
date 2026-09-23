import type { ITerminalOptions } from '@xterm/xterm'
import { normalizeXtermTheme } from './xtermTheme'
import type { TerminalTheme } from '../themes'

/** Mono stack every terminal falls back to. Shared with the CSS var wiring in index.css. */
export const DEFAULT_MONO_STACK = '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, Menlo, Monaco, "Courier New", monospace'

/**
 * Per-glyph fallbacks for scripts the Latin mono stacks above lack entirely (CJK, Korean, emoji),
 * grouped by the platform that ships them. None of these are monospace, so they only ever supply
 * glyphs the primary stack is missing — xterm falls through to them character by character.
 */
export const UNICODE_FALLBACK_FAMILIES = [
  // Windows
  'Microsoft YaHei', 'Yu Gothic', 'Malgun Gothic', 'Nirmala UI', 'Segoe UI Emoji',
  // macOS
  'PingFang SC', 'Hiragino Sans', 'Apple SD Gothic Neo', 'Apple Color Emoji',
  // Linux
  'Noto Sans Mono CJK SC', 'Noto Color Emoji',
] as const

const familyKey = (family: string): string => family.trim().replace(/^['"]|['"]$/g, '').toLowerCase()

/**
 * The font-family value xterm is actually constructed and measured with: the chosen stack (the
 * default, a theme's, or the user's own), followed by any Unicode fallback family it does not
 * already contain. A family already present (by name, ignoring quotes and case) is never added
 * twice, so a user who lists "Microsoft YaHei" first keeps their own priority for it.
 */
export const resolveTerminalFontFamily = (stack: string = DEFAULT_MONO_STACK): string => {
  const present = new Set(stack.split(',').map(familyKey))
  const missing = UNICODE_FALLBACK_FAMILIES.filter(family => !present.has(familyKey(family)))
  return missing.length === 0 ? stack : `${stack}, ${missing.map(family => `"${family}"`).join(', ')}`
}

export interface TerminalOptionsInput {
  /** LOCAL (WSL/PowerShell/CMD) panes run over ConPTY; an SSH channel does not. */
  isLocal: boolean
  /** Appearance mode controls xterm's per-cell contrast correction for light palettes. */
  darkMode?: boolean
  fontSize?: number
  fontFamilyMono?: string
  theme: TerminalTheme
}

/**
 * The option set every pane is constructed with, in one place so a pane in a detached window can
 * never drift from one in the main window.
 */
export const createTerminalOptions = ({ isLocal, darkMode, fontSize, fontFamilyMono, theme }: TerminalOptionsInput): ITerminalOptions => ({
  cursorBlink: true,
  // Spelled out so an unfocused pane's cursor can never silently regress to xterm's own default
  // hollow-outline fallback, which reads as "the cursor is gone".
  cursorStyle: 'block',
  cursorInactiveStyle: 'outline',
  fontSize: fontSize ?? 14,
  fontFamily: resolveTerminalFontFamily(fontFamilyMono),
  letterSpacing: 0,
  // 1.15 accumulated fractional-pixel rounding drift on the DOM renderer, misaligning box-drawing
  // rows in full-screen TUIs; 1.2 keeps rows on whole-pixel offsets.
  lineHeight: 1.2,
  // Dark themes keep agent/TUI-selected colors unchanged. Light themes need per-cell correction:
  // agent UIs commonly draw bold pale ANSI colors over dark highlight backgrounds, and a palette
  // repaired against only the pane background cannot make both combinations readable.
  //
  // xterm documents this as an expensive option: it recomputes a colour per
  // cell and the result cannot be cached in the renderer's glyph atlas, so a pane under heavy output
  // pays for it on every frame. Limit it to light mode, where the readability issue occurs.
  //
  minimumContrastRatio: darkMode === false ? 2.5 : 1,
  scrollback: 5000,
  allowProposedApi: true, // required by the Unicode11Addon
  // ConPTY-specific wrap/reflow heuristics; SSH's channel isn't ConPTY.
  ...(isLocal ? { windowsPty: { backend: 'conpty' as const } } : {}),
  theme: normalizeXtermTheme(theme, darkMode === false),
})
