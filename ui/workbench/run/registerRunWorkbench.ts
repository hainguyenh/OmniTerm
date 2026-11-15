import { isLive, useRun } from '../../ide/features/run/store'
import { registerActions } from '../../ide/platform/actions'
import { registerToolWindow, toolWindowService } from '../../ide/workbench/contributions'

import { RunConsoleTabs, RunConsoleToolWindow } from './RunConsoleToolWindow'
import { runScriptWithUnifiedRunner } from './scriptRunProducer'

/**
 * Registers the Run workbench adapter in OmniTerm:
 * - Overrides the default 'run' tool window with `requiresProject: false`
 * - Mounts `RunConsoleToolWindow` and `RunConsoleTabs`
 * - Provides workbench actions for script execution and console navigation
 */
export function registerRunWorkbench(): () => void {
  const disposers: Array<() => void> = []

  disposers.push(
    registerToolWindow({
      id: 'run',
      title: 'Run',
      icon: 'toolwindow-run',
      anchor: 'bottom',
      order: 5,
      requiresProject: false,
      component: RunConsoleToolWindow,
      headerContent: RunConsoleTabs,
      useBadge: () => useRun.getState().sessions.filter(isLive).length || null,
    }),
  )

  disposers.push(
    registerActions([
      {
        id: 'omniterm.runScript',
        title: 'Run Workspace Script',
        category: 'Run',
        description: 'Execute a workspace shell/batch/powershell script with the unified runner',
        icon: 'run',
        run: async ({ arg }) => {
          if (typeof arg === 'string') {
            await runScriptWithUnifiedRunner(arg)
          } else if (arg && typeof arg === 'object' && 'path' in arg) {
            const item = arg as { path: string; args?: string[]; cwd?: string; env?: Record<string, string> }
            await runScriptWithUnifiedRunner(item.path, item)
          }
        },
      },
      {
        id: 'workbench.run.showConsole',
        title: 'Show Run Console',
        category: 'Run',
        hidden: true,
        run: () => {
          toolWindowService().show('run', true)
        },
      },
    ]),
  )

  return () => {
    disposers.reverse().forEach((dispose) => dispose())
  }
}
