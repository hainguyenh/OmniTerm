/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'

import {
  ART_NOMINAL_BOX,
  ART_REF_WIDTH,
  calcArtDistanceFactor,
  useArtDistanceFactor,
} from '../artDistance'

describe('artDistance', () => {
  describe('calcArtDistanceFactor', () => {
    it('returns 1 for non-positive widths or when unmeasured', () => {
      expect(calcArtDistanceFactor(0)).toBe(1)
      expect(calcArtDistanceFactor(-50)).toBe(1)
    })

    it('returns exactly 1 at the reference width 200px', () => {
      expect(calcArtDistanceFactor(ART_REF_WIDTH, ART_NOMINAL_BOX)).toBe(1)
    })

    it('maintains constant travel speed across varying header widths', () => {
      const baseDuration = 10 // e.g. 10s base duration
      const boxSize = ART_NOMINAL_BOX
      const testWidths = [100, 150, 200, 300, 450, 600, 800]

      const speeds = testWidths.map((w) => {
        const factor = calcArtDistanceFactor(w, boxSize)
        const duration = baseDuration * factor
        const distance = w - boxSize
        return Number((distance / duration).toFixed(2))
      })

      // Every width should produce virtually the identical linear speed
      const expectedSpeed = speeds[2] // Speed at reference width 200px
      for (const speed of speeds) {
        expect(Math.abs(speed - expectedSpeed)).toBeLessThanOrEqual(0.05)
      }
    })

    it('clamps factor to minimum 0.15 for very small widths', () => {
      expect(calcArtDistanceFactor(10, ART_NOMINAL_BOX)).toBe(0.15)
      expect(calcArtDistanceFactor(20, ART_NOMINAL_BOX)).toBe(0.15)
    })
  })

  describe('useArtDistanceFactor', () => {
    it('returns undefined when ref has no element or 0 width', () => {
      const ref = { current: null }
      const { result } = renderHook(() => useArtDistanceFactor(ref))
      expect(result.current).toBeUndefined()
    })

    it('observes element resize and updates distance factor', () => {
      let resizeCb: (() => void) | undefined
      const observe = vi.fn()
      const disconnect = vi.fn()

      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(cb: () => void) {
            resizeCb = cb
          }
          observe = observe
          disconnect = disconnect
        },
      )

      const element = document.createElement('span')
      let currentWidth = 200
      vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
        () => ({ width: currentWidth } as DOMRect),
      )

      const ref = { current: element }
      const { result, unmount } = renderHook(() => useArtDistanceFactor(ref))

      expect(observe).toHaveBeenCalledWith(element)
      expect(result.current).toBe(1)

      // Header width doubles to 400px
      currentWidth = 400
      act(() => {
        resizeCb?.()
      })
      expect(result.current).toBe(calcArtDistanceFactor(400))

      unmount()
      expect(disconnect).toHaveBeenCalled()
      vi.unstubAllGlobals()
    })

    it('gracefully handles environment without ResizeObserver', () => {
      const original = (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver
      try {
        delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver
        const element = document.createElement('span')
        vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ width: 300 } as DOMRect)
        const ref = { current: element }
        const { result } = renderHook(() => useArtDistanceFactor(ref))
        expect(result.current).toBe(calcArtDistanceFactor(300))
      } finally {
        ;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = original
      }
    })
  })
})
