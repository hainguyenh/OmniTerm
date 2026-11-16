import loadingFastDarkUrl from '../../../assets/loading/converted/loading-fast-dark.gif'
import loadingFastLightUrl from '../../../assets/loading/converted/loading-fast-light.gif'
import loadingOnTrackDarkUrl from '../../../assets/loading/converted/loading-on-track-dark.gif'
import loadingOnTrackLightUrl from '../../../assets/loading/converted/loading-on-track-light.gif'
import loadingOvershootingDarkUrl from '../../../assets/loading/converted/loading-overshooting-dark.gif'
import loadingOvershootingLightUrl from '../../../assets/loading/converted/loading-overshooting-light.gif'
import loadingSlowDarkUrl from '../../../assets/loading/converted/loading-slow-dark.gif'
import loadingSlowLightUrl from '../../../assets/loading/converted/loading-slow-light.gif'

import type { PaceTier } from './quotaConfig'
import { useEffect, useSyncExternalStore } from 'react'

export interface HeaderLoadingArt {
  light: string
  dark: string
}

/** Built-in normalized artwork, one per pace tier and colour mode. Uploads replace them per slot. */
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

const TIERS: PaceTier[] = ['slow', 'onTrack', 'fast', 'overshooting']

function emptyPaceArt(): PaceArtMap {
  return {
    slow: { light: null, dark: null },
    onTrack: { light: null, dark: null },
    fast: { light: null, dark: null },
    overshooting: { light: null, dark: null },
  }
}

/**
 * Uploaded pace artwork, shared by every pane header and the settings page: one set of `customArt`
 * reads for the whole window instead of eight per mounted header.
 */
let paceArt: PaceArtMap = emptyPaceArt()
let loaded = false
const listeners = new Set<() => void>()

/** Re-read every pace slot (after an upload or reset) and notify all subscribers. */
export function refreshPaceArt(): void {
  loaded = true
  if (!window?.omnitermAPI?.customArt) return
  Promise.all(
    TIERS.flatMap((tier) => [
      window.omnitermAPI.customArt.get(PACE_SLOTS[tier].light).then((url) => ({ tier, mode: 'light' as const, url })),
      window.omnitermAPI.customArt.get(PACE_SLOTS[tier].dark).then((url) => ({ tier, mode: 'dark' as const, url })),
    ]),
  ).then((results) => {
    const next = emptyPaceArt()
    for (const { tier, mode, url } of results) next[tier][mode] = url
    paceArt = next
    for (const listener of listeners) listener()
  }).catch(() => {})
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePaceCustomArt() {
  useEffect(() => {
    if (!loaded) refreshPaceArt()
  }, [])
  const art = useSyncExternalStore(subscribe, () => paceArt, () => paceArt)
  return { paceArt: art, refresh: refreshPaceArt }
}

/** The artwork for one tier and mode: the user's upload for that slot, else the built-in GIF. */
export function resolvePaceArt(tier: PaceTier, mode: 'light' | 'dark', customArtMap?: PaceArtMap | null): string {
  return customArtMap?.[tier]?.[mode] ?? HEADER_LOADING_ART[tier][mode]
}

export function resetPaceArtForTests(): void {
  paceArt = emptyPaceArt()
  loaded = false
  listeners.clear()
}
