import { useCallback, useState } from 'react'
import { toRatios, type SplitRatios } from '../paneLayout'

/**
 * The adjustable pane boundaries: live in state so a drag reflows the panes immediately, persisted to
 * settings only when the drag ends (a write per pointermove would be hundreds of disk writes per drag).
 */
export function useSplitRatios(
  appSettings: AppSettings,
  setAppSettings: (s: AppSettings) => void,
): [SplitRatios, (next: SplitRatios) => void, (next: SplitRatios) => void] {
  const [ratios, setRatios] = useState<SplitRatios>(() => toRatios(appSettings.splitRatios))
  const persist = useCallback((next: SplitRatios) => {
    const merged = { ...appSettings, splitRatios: next }
    setAppSettings(merged)
    window.omnitermAPI.settings.save(merged)
  }, [appSettings, setAppSettings])
  return [ratios, setRatios, persist]
}
