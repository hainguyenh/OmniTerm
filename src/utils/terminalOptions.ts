import type { ITerminalOptions } from '@xterm/xterm'
import { normalizeXtermTheme } from './xtermTheme'
import type { TerminalTheme } from '../themes'

/** Mono stack every terminal falls back to. Shared with the CSS var wiring in index.css. */
export const DEFAULT_MONO_STACK = '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, Menlo, Monaco, "Courier New", monospace'

export interface TerminalOptionsInput {
  /** LOCAL (WSL/PowerShell/CMD) panes run over ConPTY; an SSH channel does not. */
  isLocal: boolean
  fontSize?: number
  fontFamilyMono?: string
  theme: TerminalTheme
}

/**
 * The option set every pane is constructed with, in one place so a pane in a detached window can
 * never drift from one in the main window.
 */
export const createTerminalOptions = ({ isLocal, fontSize, fontFamilyMono, theme }: TerminalOptionsInput): ITerminalOptions => ({
  cursorBlink: true,
  // Spelled out so an unfocused pane's cursor can never silently regress to xterm's own default
  // hollow-outline fallback, which reads as "the cursor is gone".
  cursorStyle: 'block',
  cursorInactiveStyle: 'outline',
  fontSize: fontSize ?? 14,
  fontFamily: fontFamilyMono ?? DEFAULT_MONO_STACK,
  letterSpacing: 0,
  // 1.15 accumulated fractional-pixel rounding drift on the DOM renderer, misaligning box-drawing
  // rows in full-screen TUIs; 1.2 keeps rows on whole-pixel offsets.
  lineHeight: 1.2,
  // OFF (1 = no adjustment). xterm documents this as an expensive option: it recomputes a colour per
  // cell and the result cannot be cached in the renderer's glyph atlas, so a pane under heavy output
  // pays for it on every frame. It also silently rewrites the colours an agent TUI chose, which is
  // its own rendering bug.
  //
  // The invisible-text problem it was guarding is handled a layer up instead: normalizeXtermTheme
  // repairs a theme's palette and foreground against its own background (see xtermTheme.ts), which
  // covers every colour a theme can name. What is genuinely given up is 256-colour and truecolour
  // SGR values a remote program emits directly — a theme repair cannot reach those. Extend
  // xtermTheme.ts if such a case turns up; do not re-enable this.
  minimumContrastRatio: 1,
  scrollback: 5000,
  allowProposedApi: true, // required by the Unicode11Addon
  // ConPTY-specific wrap/reflow heuristics; SSH's channel isn't ConPTY.
  ...(isLocal ? { windowsPty: { backend: 'conpty' as const } } : {}),
  theme: normalizeXtermTheme(theme),
})
