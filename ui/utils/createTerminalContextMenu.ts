import type { ILinkHandler, Terminal } from '@xterm/xterm'
import {
  findLinkOrPathInTerminal,
  isTerminalLinkModifierClick,
  oscLinkTarget,
  type DetectedLinkOrPath,
  type TerminalLinkMenuKind,
} from './terminalLinks'

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
  /** 1-based line printed after a path (`a.ts:12`). */
  line?: number
  /** 1-based column printed after the line. */
  col?: number
  /** Readings of a path joined across a hard line break, tried before `text`. */
  candidates?: string[]
  /** Opened by a right-click, which otherwise pastes: the menu then offers Paste too. */
  fromContextMenu?: boolean
}

/** A path printed in the pane, with the location after it. */
export type TerminalPathLink = Pick<DetectedLinkOrPath, 'text' | 'line' | 'col' | 'candidates'>

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
  /** Open a modifier-clicked path straight away (a local pane opens it in the editor). Without it
   *  the click shows the Copy/Open menu, as it does for a URL. */
  openPath?: (link: TerminalPathLink) => void
}

export interface TerminalContextMenuHandlers {
  /** `contextmenu` listener — copies a selection; on a URL or path shows its menu (with Paste);
   *  anywhere else pastes. */
  onContextMenu: (e: MouseEvent) => void
  /** `mousedown` listener (capture phase) — surfaces the link/path overlay when the platform
   *  link-modifier + left button lands on a URL or file path. Falls through silently for non-link
   *  clicks so xterm keeps its normal selection / caret behaviour. */
  onLinkClick: (e: MouseEvent) => void
  /** xterm's `linkHandler` for OSC 8 hyperlinks: a modifier click on one opens its file or shows its
   *  URL menu, as a plain-text detection would. */
  linkHandler: ILinkHandler
}

/**
 * Build the pane's right-click and link-modifier-click handlers as a pair. Surfacing a Copy/Open
 * overlay when a modifier click lands on a URL or file path is the only reason `onLinkClick` wraps
 * a raw MouseEvent — otherwise the gesture falls through to xterm's normal selection. `onContextMenu`
 * owns the long-standing paste-fallback behaviour (copy-selection if a range is set, otherwise paste)
 * except on a URL or path, where it shows the same menu with a Paste item so paste is one click on.
 *
 * Kept glue-free (no React, no xterm state types beyond `Terminal`) so a unit test can drive it
 * with plain stubs.
 */
export const createTerminalContextMenu =
  (args: CreateTerminalContextMenuArgs): TerminalContextMenuHandlers => {
    const detectAt = (e: MouseEvent): DetectedLinkOrPath | null => {
      const termEl = args.termElRef.current
      return termEl ? findLinkOrPathInTerminal(args.term, termEl, e.clientX, e.clientY) : null
    }
    const menuFor = (e: MouseEvent, found: DetectedLinkOrPath): TerminalLinkMenuState => ({
      x: e.clientX,
      y: e.clientY,
      kind: found.kind,
      text: found.text,
      ...(found.line !== undefined ? { line: found.line } : {}),
      ...(found.col !== undefined ? { col: found.col } : {}),
      ...(found.candidates ? { candidates: found.candidates } : {}),
    })

    const onContextMenu = (e: MouseEvent): void => {
      // A selection is copied and empty space pastes, as always. A right-click on a URL or path
      // (an agent's "wrote src/x.ts") shows its menu instead, which carries Paste as well.
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      args.term.focus()
      const hasSelection =
        typeof args.term.hasSelection === 'function' && args.term.hasSelection()
      const found = hasSelection ? null : detectAt(e)
      if (hasSelection) {
        void args.clipboard.copySelection()
      } else if (found) {
        // Same suppression as below: the gesture alone must paste nothing; the menu's Paste does.
        args.setSuppressPaste()
        args.setLinkMenu({ ...menuFor(e, found), fromContextMenu: true })
      } else {
        // Chromium/xterm can dispatch a native paste after the context-menu gesture; the custom
        // route below is the single writer for right-click, so the native event must not duplicate.
        args.setSuppressPaste()
        void args.clipboard.paste()
      }
    }

    const onLinkClick = (e: MouseEvent): void => {
      // Platform-conventional modifier: Cmd on macOS, Ctrl elsewhere. The linkifier's hover-cue
      // (see `registerPlainTextLinks`) and the menu stay on the same modifier via this single check.
      if (!isTerminalLinkModifierClick(e)) return
      if (e.button !== 0) return
      const detected = detectAt(e)
      if (!detected) return
      // Stopped before xterm sees it: a TUI with mouse reporting on (agy, Claude in some modes)
      // would otherwise get the click too, and an OSC 8 link under it would activate a second time.
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      args.term.focus()
      activate(menuFor(e, detected))
    }

    const activate = (menu: TerminalLinkMenuState): void => {
      if (menu.kind === 'path' && args.openPath) args.openPath(menu)
      else args.setLinkMenu(menu)
    }

    const linkHandler: ILinkHandler = {
      // `file://` links reach `activate` too; `oscLinkTarget` keeps only local files and HTTP(S).
      allowNonHttpProtocols: true,
      activate: (e, uri) => {
        if (!isTerminalLinkModifierClick(e) || e.button !== 0) return
        const target = oscLinkTarget(uri)
        if (!target) return
        args.term.focus()
        activate({ x: e.clientX, y: e.clientY, ...target })
      },
    }

    return { onContextMenu, onLinkClick, linkHandler }
  }
