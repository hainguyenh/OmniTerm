import { useCallback, useEffect, useRef, useState } from 'react'

import { diag } from '../../diag'

/**
 * OmniTerm's stored settings for a page of the Settings window, which has no MainLayout to own
 * them. Loads through `omnitermAPI` and follows `settings:changed`, which the backend broadcasts
 * after every save from any window, so the page stays current when another window edits.
 *
 * `setAppSettings` replaces the local copy only; saving is the page's job (the legacy components
 * call `omnitermAPI.settings.save` themselves). `patch` does both for pages written for this window.
 */
export function useAppSettings(): {
  appSettings: AppSettings | null
  setAppSettings: (next: AppSettings) => void
  patch: (fields: Partial<AppSettings>) => void
} {
  const [appSettings, setLocal] = useState<AppSettings | null>(null)
  const latest = useRef<AppSettings | null>(null)

  const store = useCallback((next: AppSettings) => {
    latest.current = next
    setLocal(next)
  }, [])

  useEffect(() => {
    let live = true
    const load = () => {
      void window.omnitermAPI.settings
        .get()
        .then((s: AppSettings) => { if (live) store(s) })
        .catch((error: unknown) => diag.warn('[settings] could not load', error))
    }
    load()
    const off = window.omnitermAPI.settings.onChanged(load)
    return () => { live = false; off() }
  }, [store])

  const patch = useCallback((fields: Partial<AppSettings>) => {
    if (latest.current) store({ ...latest.current, ...fields })
    void Promise.resolve(window.omnitermAPI.settings.save(fields))
      .catch((error: unknown) => diag.error('[settings] could not save', error))
  }, [store])

  return { appSettings, setAppSettings: store, patch }
}
