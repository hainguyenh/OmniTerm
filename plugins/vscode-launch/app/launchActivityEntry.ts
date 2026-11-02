import { closeConsole, openConsoleForRun, useLaunchStore } from './launchStore'

export interface LaunchActivityEntry {
  available: boolean
  activeCount: number
  totalCount: number
  consoleOpen: boolean
  toggleConsole: () => void
}

export function useLaunchActivityEntry(): LaunchActivityEntry {
  const available = useLaunchStore((s) => s.available)
  const runs = useLaunchStore((s) => s.runs)
  const consoleOpen = useLaunchStore((s) => s.consoleOpen)

  const activeCount = runs.filter(
    (r) => r.status === 'starting' || r.status === 'running',
  ).length

  return {
    available,
    activeCount,
    totalCount: runs.length,
    consoleOpen,
    toggleConsole: () => {
      if (consoleOpen) {
        closeConsole()
      } else {
        openConsoleForRun()
      }
    },
  }
}

export default useLaunchActivityEntry
