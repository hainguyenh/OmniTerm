import React from 'react'
import TerminalLinkMenu from './TerminalLinkMenu'
import { safeHttpUrl } from '../utils/terminalLinks'
import type { TerminalLinkMenuState } from '../utils/createTerminalContextMenu'

export interface TerminalViewLinkMenuHostProps {
  /** The active overlay state or null; null renders nothing (the pane's empty state). */
  menu: TerminalLinkMenuState | null
  /** Local-pane flag — false hides the OS-open action for remote/SSH panes. */
  isLocal: boolean
  onClose: () => void
}

// Wired once: these are the only side effects the pane knows about for a single terminal
// link/path gesture. Keeping them here keeps `TerminalView.tsx` clear of the omnitermAPI surface.
const copyText = (text: string) => {
  void window.omnitermAPI.clipboard.writeText(text)
}
const openUrl = (url: string) => {
  const validated = safeHttpUrl(url)
  if (validated) window.open(validated.href, '_blank', 'noopener,noreferrer')
}
const openPath = (path: string) => {
  void window.omnitermAPI.app.openInSystem(path)
}

/** Renders the right-click link/path menu when `menu` is set, otherwise nothing. Owns the action
 *  callbacks so the host pane only has to pass menu state and `isLocal`. */
export const TerminalViewLinkMenuHost: React.FC<TerminalViewLinkMenuHostProps> = ({
  menu,
  isLocal,
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
      onClose={onClose}
    />
  ) : null

export default TerminalViewLinkMenuHost
