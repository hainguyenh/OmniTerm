import { useEffect, useState } from 'react'

import type { AreaSize } from './sessionZoom'

function measure(element: Element | null): AreaSize | null {
  const rect = element?.getBoundingClientRect()
  return rect && rect.width > 0 && rect.height > 0 ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null
}

/**
 * The size of the editor area (the box all panes share), kept current by a ResizeObserver, with the
 * window size as the fallback before the area exists. Rounded so a one-pixel wobble re-renders nothing.
 */
export function useEditorAreaSize(): AreaSize | null {
  const [size, setSize] = useState<AreaSize | null>(null)
  useEffect(() => {
    let observed: Element | null = null
    const update = () => {
      const area = document.querySelector('[data-editor-area]')
      if (area !== observed && observer) {
        if (observed) observer.unobserve(observed)
        if (area) observer.observe(area)
        observed = area
      }
      const next = measure(area) ?? { width: window.innerWidth, height: window.innerHeight }
      setSize((previous) => (previous && previous.width === next.width && previous.height === next.height ? previous : next))
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    update()
    // The workbench may mount the area after this hook: watch the DOM until it shows up, then stop.
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
      if (!document.querySelector('[data-editor-area]')) return
      mutations?.disconnect()
      update()
    })
    if (!observed) mutations?.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      mutations?.disconnect()
      observer?.disconnect()
    }
  }, [])
  return size
}
