import { executeAction, registerAction } from '../ide/platform/actions'

import {
  isConnectionsVisible,
  toggleConnectionsVisibility,
} from './connections/workspaceConnectionsRoot'

/**
 * Registers project tree actions for OmniTerm:
 * - `terminal.openAt`: opens a terminal session in the folder via `omniterm:new-session`
 * - `p5.tree.toolbar.locate`: alias executing `navigate.selectInProjectView`
 * - `p5.tree.toolbar.toggleConnections`: toggles workspace connections visibility
 */
export function registerProjectTreeActions(): () => void {
  const disposers = [
    registerAction({
      id: 'terminal.openAt',
      title: 'Open in Terminal',
      category: 'Terminal',
      description: 'Open a new terminal session at the selected folder',
      icon: 'terminal',
      run: ({ arg }) => {
        const cwd = typeof arg === 'string'
          ? arg
          : (arg && typeof arg === 'object' && 'cwd' in arg && typeof (arg as { cwd: unknown }).cwd === 'string'
              ? (arg as { cwd: string }).cwd
              : undefined)
        window.dispatchEvent(new CustomEvent('omniterm:new-session', { detail: { cwd } }))
      },
    }),
    registerAction({
      id: 'p5.tree.toolbar.locate',
      title: 'Select Opened File',
      category: 'Navigate',
      description: 'Scroll the project tree to the active editor file',
      icon: 'locate',
      run: ({ arg }) => {
        void executeAction('navigate.selectInProjectView', arg)
      },
    }),
    registerAction({
      id: 'p5.tree.toolbar.toggleConnections',
      title: 'Toggle Connections',
      category: 'View',
      description: 'Show or hide workspace connections in the project view',
      icon: 'network',
      toggled: () => isConnectionsVisible(),
      run: () => {
        toggleConnectionsVisibility()
      },
    }),
  ]

  return () => {
    disposers.reverse().forEach((dispose) => dispose())
  }
}
