import type { Terminal } from '@xterm/xterm'
import { createCoalescer, type Coalescer } from './coalesce'

/**
 * Re-measures xterm's character grid after WebView-level changes that alter CSS pixel density
 * with no DOM resize event (app/detached-window zoom in App.tsx / DetachedTerminalWindow.tsx,
 * and fonts that finish loading asynchronously like Cascadia Code). Stale cached measurements
 * draw glyphs at one width while measuring at another — part of why detaching a window "fixes"
 * a garbled pane, since remounting re-measures fresh. Toggling `fontFamily` forces the same
 * re-measure publicly: its option setter skips the work when the value doesn't change.
 *
 * Coalesced, because a re-measure re-rasterizes every glyph: holding Ctrl+wheel fires one zoom
 * step per notch, and doing this on each one is the same kind of thrash the ResizeObserver had.
 */
export const createFontRemeasurer = (term: Terminal, refit: () => void): Coalescer =>
  createCoalescer(() => {
    const family = term.options.fontFamily
    term.options.fontFamily = `${family} `
    term.options.fontFamily = family
    refit()
  }, 70)
