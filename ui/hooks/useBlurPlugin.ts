import { useEffect, useState } from 'react'

/**
 * Probes the plugin host for the blur plugin's presence.
 *
 * The hook retries a handful of times with back-off because the Node.js sidecar
 * that hosts plugins launches asynchronously — in portable builds the sidecar
 * may still be loading when the React tree first mounts. Without retries the
 * single mount-time check would silently fail and the blur icon would never
 * appear in the ActivityBar.
 */
export function useBlurPlugin() {
  const [open, setOpen] = useState(false)
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    const RETRY_DELAYS = [0, 500, 1_000, 2_000, 4_000]

    function probe(attempt: number) {
      if (cancelled || attempt >= RETRY_DELAYS.length) return
      void window.omnitermAPI.plugin.invoke('blur.info')
        .then(info => {
          if (cancelled) return
          if (info) {
            setAvailable(true)
          } else if (attempt + 1 < RETRY_DELAYS.length) {
            setTimeout(() => probe(attempt + 1), RETRY_DELAYS[attempt + 1])
          }
        })
        .catch(() => {
          if (!cancelled && attempt + 1 < RETRY_DELAYS.length) {
            setTimeout(() => probe(attempt + 1), RETRY_DELAYS[attempt + 1])
          }
        })
    }

    probe(0)
    return () => {
      cancelled = true
    }
  }, [])

  return { open, setOpen, available }
}
