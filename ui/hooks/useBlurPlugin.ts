import { useEffect, useState } from 'react'

export function useBlurPlugin() {
  const [open, setOpen] = useState(false)
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.omnitermAPI.plugin.invoke('blur.info')
      .then(info => {
        if (!cancelled && info) setAvailable(true)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return { open, setOpen, available }
}
