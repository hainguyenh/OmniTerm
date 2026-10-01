import { useEffect, useState } from 'react'
import type React from 'react'

export const ART_REF_WIDTH = 200
export const ART_NOMINAL_BOX = 24

/**
 * Calculates a duration scaling factor so that the busy art travels at a constant
 * linear speed (pixels per second) regardless of container/header width.
 *
 * Travel distance is (width - boxSize). To keep velocity constant:
 * duration = baseDuration * (actualDistance / refDistance).
 */
export function calcArtDistanceFactor(width: number, boxSize = ART_NOMINAL_BOX): number {
  if (width <= 0) return 1
  const refDistance = Math.max(1, ART_REF_WIDTH - boxSize)
  const actualDistance = Math.max(16, width - boxSize)
  return Number(Math.max(0.15, actualDistance / refDistance).toFixed(3))
}

/**
 * Observes container width and returns a distance scaling factor for the travel duration.
 * When unmeasured (SSR, test or 0px width), returns undefined so CSS fallback is used.
 */
export function useArtDistanceFactor(ref: React.RefObject<HTMLElement | null>): number | undefined {
  const [factor, setFactor] = useState<number | undefined>(undefined)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const width = el.getBoundingClientRect().width
      if (width > 0) {
        setFactor(calcArtDistanceFactor(width))
      }
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return factor
}
