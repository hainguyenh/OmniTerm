import { isLive, useRun } from '../../ide/features/run/store'
import { commands, isTauri } from '../../ide/platform/ipc'
import { useDebugRunSessions } from '../../ide/workbench/contributions'

import { migrateLegacyUpdateSource } from './updateSourceSetting'
import { installUpdateChecks, setActiveSessionChecker } from './workbenchUpdater'

export function registerUpdaterWorkbench(): () => void {
  setActiveSessionChecker(() => {
    const hasLiveRun = useRun.getState().sessions.some(isLive)
    const hasLiveDebug = useDebugRunSessions.getState().sessions.length > 0
    return hasLiveRun || hasLiveDebug
  })

  const systemLocale = typeof navigator !== 'undefined' ? navigator.language : ''
  if (isTauri()) {
    void commands.appUpdateWindowReady(true, systemLocale).catch(() => {})
  }

  void migrateLegacyUpdateSource()

  const uninstallChecks = installUpdateChecks()

  return () => {
    setActiveSessionChecker(null)
    if (isTauri()) {
      void commands.appUpdateWindowReady(false, '').catch(() => {})
    }
    uninstallChecks()
  }
}
