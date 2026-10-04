import { useEffect, useState } from 'react'

export interface ScrollViewport {
  scrollTop: number
  scrollLeft: number
  width: number
  height: number
}

/**
 * The element's scroll offset and size, updated at most once per animation frame — scroll and resize
 * events can fire many times per frame, and the virtualized views only need the latest value.
 *
 * Takes the element itself (from a callback ref) rather than a ref object, so a container that only
 * mounts once its data has loaded is still picked up.
 */
export function useScrollViewport(element: HTMLElement | null): ScrollViewport {
  const [viewport, setViewport] = useState<ScrollViewport>({ scrollTop: 0, scrollLeft: 0, width: 0, height: 0 })

  useEffect(() => {
    if (!element) return
    let frame: number | null = null
    const measure = () => {
      frame = null
      setViewport((prev) => {
        const next = {
          scrollTop: element.scrollTop,
          scrollLeft: element.scrollLeft,
          width: element.clientWidth,
          height: element.clientHeight,
        }
        return prev.scrollTop === next.scrollTop && prev.scrollLeft === next.scrollLeft
          && prev.width === next.width && prev.height === next.height ? prev : next
      })
    }
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(measure)
    }
    measure()
    element.addEventListener('scroll', schedule, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(element)
    return () => {
      element.removeEventListener('scroll', schedule)
      observer?.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [element])

  return viewport
}
