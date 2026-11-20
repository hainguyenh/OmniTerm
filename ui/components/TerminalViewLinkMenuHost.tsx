import React from 'react'
import TerminalLinkMenu from './TerminalLinkMenu'
import { openExternalUrl } from '../ide/platform/openUrl'
import { safeHttpUrl } from '../utils/terminalLinks'
import type { TerminalLinkMenuState, TerminalPathLink } from '../utils/createTerminalContextMenu'

export interface TerminalViewLinkMenuHostProps {
  /** The active overlay state or null; null renders nothing (the pane's empty state). */
  menu: TerminalLinkMenuState | null
  /** Local-pane flag — false hides the OS-open action for remote/SSH panes. */
  isLocal: boolean
  /** Open a path in the editor, resolved against the pane's directory. */
  onOpenInEditor: (link: TerminalPathLink) => void
  /** Paste into the pane, for a menu a right-click opened. */
  onPaste: () => void
  onClose: () => void
}

// Wired once: these are the only side effects the pane knows about for a single terminal
// link/path gesture. Keeping them here keeps `TerminalView.tsx` clear of the omnitermAPI surface.
const copyText = (text: string) => {
  void window.omnitermAPI.clipboard.writeText(text)
}
const openUrl = (url: string) => {
  const validated = safeHttpUrl(url)
  // The system browser: `window.open` in the desktop webview pops a page over the app instead.
  if (validated) void openExternalUrl(validated.href).catch(() => {})
}
const openPath = (path: string) => {
  void window.omnitermAPI.app.openInSystem(path)
}

/** Renders the right-click link/path menu when `menu` is set, otherwise nothing. Owns the action
 *  callbacks so the host pane only has to pass menu state and `isLocal`. */
export const TerminalViewLinkMenuHost: React.FC<TerminalViewLinkMenuHostProps> = ({
  menu,
  isLocal,
  onOpenInEditor,
  onPaste,
  onClose,
}) =>
  menu ? (
    <TerminalLinkMenu
      x={menu.x}
      y={menu.y}
      kind={menu.kind}
      text={menu.text}
      isLocal={isLocal}
      onCopyText={copyText}
      onOpenUrl={openUrl}
      onOpenPath={openPath}
      onOpenInEditor={(text) => onOpenInEditor({ text, line: menu.line, col: menu.col })}
      {...(menu.fromContextMenu ? { onPaste } : {})}
      onClose={onClose}
    />
  ) : null

export default TerminalViewLinkMenuHost
