import { useCallback, useEffect, useRef, useState } from 'react'

export function useCustomArt(darkMode: boolean) {
  const [idleArtUrlLight, setIdleArtUrlLight] = useState<string | null>(null)
  const [idleArtUrlDark, setIdleArtUrlDark] = useState<string | null>(null)
  const [loadingArtUrlLight, setLoadingArtUrlLight] = useState<string | null>(null)
  const [loadingArtUrlDark, setLoadingArtUrlDark] = useState<string | null>(null)
  const refreshCustomArt = useCallback(() => {
    window.omnitermAPI.customArt.get('idle-light').then(setIdleArtUrlLight).catch(() => setIdleArtUrlLight(null))
    window.omnitermAPI.customArt.get('idle-dark').then(setIdleArtUrlDark).catch(() => setIdleArtUrlDark(null))
    window.omnitermAPI.customArt.get('loading-light').then(setLoadingArtUrlLight).catch(() => setLoadingArtUrlLight(null))
    window.omnitermAPI.customArt.get('loading-dark').then(setLoadingArtUrlDark).catch(() => setLoadingArtUrlDark(null))
  }, [])
  useEffect(() => { refreshCustomArt() }, [refreshCustomArt])
  // The Settings window edits the art and bumps `customArtRevision` (see workbench/settings/customArtSync).
  const revision = useRef<number | undefined>(undefined)
  useEffect(() => window.omnitermAPI.settings.onChanged((settings: AppSettings) => {
    if (settings?.customArtRevision === revision.current) return
    revision.current = settings?.customArtRevision
    refreshCustomArt()
  }), [refreshCustomArt])
  return {
    idleArtUrl: darkMode ? idleArtUrlDark : idleArtUrlLight,
    loadingArtUrl: darkMode ? loadingArtUrlDark : loadingArtUrlLight,
    idleArtUrlLight, idleArtUrlDark, loadingArtUrlLight, loadingArtUrlDark,
    refreshCustomArt,
  }
}
