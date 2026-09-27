import loadingFastDarkUrl from '../../../assets/loading/converted/loading-fast-dark.gif'
import loadingFastLightUrl from '../../../assets/loading/converted/loading-fast-light.gif'
import loadingOnTrackDarkUrl from '../../../assets/loading/converted/loading-on-track-dark.gif'
import loadingOnTrackLightUrl from '../../../assets/loading/converted/loading-on-track-light.gif'
import loadingOvershootingDarkUrl from '../../../assets/loading/converted/loading-overshooting-dark.gif'
import loadingOvershootingLightUrl from '../../../assets/loading/converted/loading-overshooting-light.gif'
import loadingSlowDarkUrl from '../../../assets/loading/converted/loading-slow-dark.gif'
import loadingSlowLightUrl from '../../../assets/loading/converted/loading-slow-light.gif'

import type { PaceTier } from './quotaConfig'
import { useCallback, useEffect, useState } from 'react'

export interface HeaderLoadingArt {
  light: string
  dark: string
}

/** Built-in normalized artwork; custom artwork remains reserved for quota-provider fetching. */
export const HEADER_LOADING_ART: Record<PaceTier, HeaderLoadingArt> = {
  slow: { light: loadingSlowLightUrl, dark: loadingSlowDarkUrl },
  onTrack: { light: loadingOnTrackLightUrl, dark: loadingOnTrackDarkUrl },
  fast: { light: loadingFastLightUrl, dark: loadingFastDarkUrl },
  overshooting: { light: loadingOvershootingLightUrl, dark: loadingOvershootingDarkUrl },
}

export type PaceArtSlot = `pace-${PaceTier}-${'light' | 'dark'}`

export const PACE_SLOTS: Record<PaceTier, { light: PaceArtSlot; dark: PaceArtSlot }> = {
  slow: { light: 'pace-slow-light', dark: 'pace-slow-dark' },
  onTrack: { light: 'pace-onTrack-light', dark: 'pace-onTrack-dark' },
  fast: { light: 'pace-fast-light', dark: 'pace-fast-dark' },
  overshooting: { light: 'pace-overshooting-light', dark: 'pace-overshooting-dark' },
}

export type PaceArtMap = Record<PaceTier, { light: string | null; dark: string | null }>

export function usePaceCustomArt() {
  const [paceArt, setPaceArt] = useState<PaceArtMap>({
    slow: { light: null, dark: null },
    onTrack: { light: null, dark: null },
    fast: { light: null, dark: null },
    overshooting: { light: null, dark: null },
  })

  const refresh = useCallback(() => {
    if (!window?.omnitermAPI?.customArt) return
    const tiers: PaceTier[] = ['slow', 'onTrack', 'fast', 'overshooting']
    Promise.all(
      tiers.flatMap((tier) => [
        window.omnitermAPI.customArt.get(PACE_SLOTS[tier].light).then((url) => ({ tier, mode: 'light' as const, url })),
        window.omnitermAPI.customArt.get(PACE_SLOTS[tier].dark).then((url) => ({ tier, mode: 'dark' as const, url })),
      ]),
    ).then((results) => {
      const next: PaceArtMap = {
        slow: { light: null, dark: null },
        onTrack: { light: null, dark: null },
        fast: { light: null, dark: null },
        overshooting: { light: null, dark: null },
      }
      for (const { tier, mode, url } of results) {
        next[tier][mode] = url
      }
      setPaceArt(next)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { paceArt, refresh }
}

export function resolvePaceArt(
  tier: PaceTier,
  mode: 'light' | 'dark',
  customArtMap?: PaceArtMap | null,
  sessionArtUrl?: string | null,
): string {
  if (customArtMap?.[tier]?.[mode]) {
    return customArtMap[tier][mode]!
  }
  if (sessionArtUrl) {
    return sessionArtUrl
  }
  return HEADER_LOADING_ART[tier][mode]
}
