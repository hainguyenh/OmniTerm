import { diag } from '../../diag'

/**
 * Tells the other windows that custom artwork changed. The art files live on disk and each window
 * reads them through its own `useCustomArt`, so a page of the Settings window bumps a revision in
 * the stored settings; the backend broadcasts every save and `useCustomArt` refreshes when the
 * revision moves.
 */
export function notifyCustomArtChanged(): void {
  void Promise.resolve(window.omnitermAPI.settings.save({ customArtRevision: Date.now() }))
    .catch((error: unknown) => diag.error('[settings] could not announce the artwork change', error))
}
