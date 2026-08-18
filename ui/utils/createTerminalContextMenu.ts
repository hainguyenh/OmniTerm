import type { Terminal } from '@xterm/xterm'
import { findLinkOrPathInTerminal, isTerminalLinkModifierClick, type TerminalLinkMenuKind } from './terminalLinks'

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
   *  pane teardown between register and click. */
  termElRef: { current: HTMLDivElement | null }
  clipboard: TerminalContextMenuClipboard
  /** Show the link/path overlay when a detection hits. */
  setLinkMenu: (state: TerminalLinkMenuState) => void
  /** Arms the post-contextmenu native-paste suppression window (also used by the terminal's
   *  own paste handler). */
  setSuppressPaste: () => void
}

export interface TerminalContextMenuHandlers {
  /** `contextmenu` listener — paste-fallback only (copy-selection if a range is set, else paste).
   *  Link detection is no longer part of the right-click path; it lives on `onLinkClick`. */
  onContextMenu: (e: MouseEvent) => void
  /** `mousedown` listener — surfaces the link/path overlay when the platform link-modifier + left
   *  button lands on a URL or file path. Falls through silently for non-link clicks so xterm keeps
   *  its normal selection / caret behaviour. */
  onLinkClick: (e: MouseEvent) => void
}

/**
 * Build the pane's right-click and link-modifier-click handlers as a pair. Surfacing a Copy/Open
 * overlay when a modifier click lands on a URL or file path is the only reason `onLinkClick` wraps
 * a raw MouseEvent — otherwise the gesture falls through to xterm's normal selection. `onContextMenu`
 * owns the long-standing paste-fallback behaviour (copy-selection if a range is set, otherwise paste)
 * without doing link detection so right-click stays predictable for paste users.
 *
 * Kept glue-free (no React, no xterm state types beyond `Terminal`) so a unit test can drive it
 * with plain stubs.
 */
export const createTerminalContextMenu =
  (args: CreateTerminalContextMenuArgs): TerminalContextMenuHandlers => {
    const onContextMenu = (e: MouseEvent): void => {
      // Paste-fallback only; the link/path overlay is driven by the platform link-modifier click
      // (see `onLinkClick`), not by the right-click gesture.
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

    const onLinkClick = (e: MouseEvent): void => {
      // Platform-conventional modifier: Cmd on macOS, Ctrl elsewhere. The linkifier's hover-cue
      // (see `registerPlainUrlLinks`) and the menu stay on the same modifier via this single check.
      if (!isTerminalLinkModifierClick(e)) return
      if (e.button !== 0) return
      const termEl = args.termElRef.current
      if (!termEl) return
      const detected = findLinkOrPathInTerminal(args.term, termEl, e.clientX, e.clientY)
      if (!detected) return
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
    }

    return { onContextMenu, onLinkClick }
  }
