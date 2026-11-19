import { registerAction } from '../../ide/platform/actions'
import { registerToolWindow } from '../../ide/workbench/contributions'

import { requestDockedTerminal, TERMINAL_WINDOW } from './terminalDockActions'
import { installTerminalEscapeClaim } from './terminalEscapeClaim'
import { startTerminalDockSync, useTerminalDock } from './terminalDockStore'
import { TerminalDockTabs, TerminalToolWindow } from './TerminalToolWindow'

/**
 * OmniTerm's Terminal tool window at the bottom: OmniTerm sessions (the same persistent shells as
 * the editor's session tabs) docked below the editor, with their tabs in the window header.
 */
export function registerTerminalToolWindow(): () => void {
  const disposers = [
    startTerminalDockSync(),
    installTerminalEscapeClaim(),
    registerToolWindow({
      id: TERMINAL_WINDOW,
      title: 'Terminal',
      icon: 'toolwindow-terminal',
      anchor: 'bottom',
      order: 0,
      requiresProject: false,
      component: TerminalToolWindow,
      headerContent: TerminalDockTabs,
      // How many sessions run down here, so one started from elsewhere is not lost behind a closed window.
      useBadge: () => useTerminalDock((state) => state.docked.length || null),
    }),
    registerAction({
      id: 'omniterm.terminal.new',
      title: 'New Terminal in Tool Window',
      category: 'Terminal',
      icon: 'plus',
      verbatim: true,
      run: requestDockedTerminal,
    }),
  ]
  return () => disposers.reverse().forEach((dispose) => dispose())
}
