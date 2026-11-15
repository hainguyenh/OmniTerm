import { executeAction, registerActions } from '../../ide/platform/actions'
import { registerToolWindow, toolWindowService } from '../../ide/workbench/contributions'

import { DebuggerTabs, DebuggerToolWindow } from './DebuggerToolWindow'

/**
 * Registers the Debugger workbench adapter in OmniTerm:
 * - Overrides the default 'debug' tool window with `requiresProject: false`
 * - Mounts `DebuggerToolWindow` and `DebuggerTabs`
 * - Provides workbench actions for stepping, pause, resume, and stop
 */
export function registerDebuggerWorkbench(): () => void {
  const disposers: Array<() => void> = []

  disposers.push(
    registerToolWindow({
      id: 'debug',
      title: 'Debug',
      icon: 'toolwindow-debug',
      anchor: 'bottom',
      order: 20,
      requiresProject: false,
      component: DebuggerToolWindow,
      headerContent: DebuggerTabs,
    }),
  )

  disposers.push(
    registerActions([
      {
        id: 'workbench.debug.stepOver',
        title: 'Step Over',
        category: 'Debug',
        icon: 'step-over',
        run: async () => {
          await executeAction('debug.stepOver')
        },
      },
      {
        id: 'workbench.debug.stepInto',
        title: 'Step Into',
        category: 'Debug',
        icon: 'step-into',
        run: async () => {
          await executeAction('debug.stepInto')
        },
      },
      {
        id: 'workbench.debug.stepOut',
        title: 'Step Out',
        category: 'Debug',
        icon: 'step-out',
        run: async () => {
          await executeAction('debug.stepOut')
        },
      },
      {
        id: 'workbench.debug.resume',
        title: 'Resume Program',
        category: 'Debug',
        icon: 'resume',
        run: async () => {
          await executeAction('debug.resume')
        },
      },
      {
        id: 'workbench.debug.pause',
        title: 'Pause Program',
        category: 'Debug',
        icon: 'pause',
        run: async () => {
          await executeAction('debug.pause')
        },
      },
      {
        id: 'workbench.debug.stop',
        title: 'Stop Debug Session',
        category: 'Debug',
        icon: 'stop',
        run: async () => {
          await executeAction('debug.stop')
        },
      },
      {
        id: 'workbench.debug.show',
        title: 'Show Debug Tool Window',
        category: 'Debug',
        hidden: true,
        run: () => {
          toolWindowService().show('debug', true)
        },
      },
    ]),
  )

  return () => {
    disposers.reverse().forEach((dispose) => dispose())
  }
}
