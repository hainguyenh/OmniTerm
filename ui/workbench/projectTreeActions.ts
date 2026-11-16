import { executeAction, registerAction } from '../ide/platform/actions'

/**
 * Registers project tree actions for OmniTerm:
 * - `terminal.openAt`: opens a terminal session in the folder via `omniterm:new-session`
 * - `p5.tree.toolbar.locate`: alias executing `navigate.selectInProjectView`
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
  ]

  return () => {
    disposers.reverse().forEach((dispose) => dispose())
  }
}
