import type { Terminal } from '@xterm/xterm'
import { findLinkOrPathInTerminal, type TerminalLinkMenuKind } from './terminalLinks'

// The clipboard surface a pane already wires up — see `createTerminalClipboard`. The handler only
// needs copy-selection + paste, so a structural type keeps this free of xterm-addon-clipboard imports.
export interface TerminalContextMenuClipboard {
  copySelection: () => Promise<void> | void
  paste: () => Promise<void> | void
}

/** State handed to a `TerminalLinkMenuHost`: where the cursor was, what was detected, and its text. */
export interface TerminalLinkMenuState {
  x: number
  y: number
  kind: TerminalLinkMenuKind
  text: string
}

export interface CreateTerminalContextMenuArgs {
  term: Terminal
  /** The DOM element xterm renders into, read at click time so a stale closure does not race a
   *  pane teardown between register and right-click. */
  termElRef: { current: HTMLDivElement | null }
  clipboard: TerminalContextMenuClipboard
  /** Show the link/path overlay when a detection hits. */
  setLinkMenu: (state: TerminalLinkMenuState) => void
  /** Arms the post-contextmenu native-paste suppression window (also used by the terminal's
   *  own paste handler). */
  setSuppressPaste: () => void
}

/**
 * Build the pane's right-click handler. Surfacing a Copy/Open overlay when the right-click lands on
 * a URL or file path is the only reason this wraps a raw MouseEvent — otherwise the gesture falls
 * through to the long-standing selection-paste behaviour (copy-selection if a range is set,
 * otherwise paste).
 *
 * Kept glue-free (no React, no xterm state types beyond `Terminal`) so a unit test can drive it
 * with plain stubs.
 */
export const createTerminalContextMenu =
  (args: CreateTerminalContextMenuArgs): ((e: MouseEvent) => void) =>
  (e: MouseEvent) => {
    const termEl = args.termElRef.current
    if (termEl) {
      const detected = findLinkOrPathInTerminal(args.term, termEl, e.clientX, e.clientY)
      if (detected) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        args.term.focus()
        args.setLinkMenu({
          x: e.clientX,
          y: e.clientY,
          kind: detected.kind,
          text: detected.text,
        })
        return
      }
    }

    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    args.term.focus()
    const hasSelection =
      typeof args.term.hasSelection === 'function' && args.term.hasSelection()
    if (hasSelection) {
      void args.clipboard.copySelection()
    } else {
      // Chromium/xterm can dispatch a native paste after the context-menu gesture; the custom
      // route below is the single writer for right-click, so the native event must not duplicate.
      args.setSuppressPaste()
      void args.clipboard.paste()
    }
  }
