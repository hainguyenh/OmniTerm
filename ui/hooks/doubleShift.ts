/** Max gap between the two taps, and max time a single tap may hold Shift down. */
const DOUBLE_SHIFT_INTERVAL_MS = 400

export interface DoubleShiftDetector {
  keydown: (e: KeyboardEvent) => void
  keyup: (e: KeyboardEvent) => void
  /** Anything that is not a clean Shift tap (a click, a window blur) breaks the sequence. */
  reset: () => void
}

const isBareShift = (e: KeyboardEvent): boolean =>
  e.key === 'Shift' && !e.ctrlKey && !e.altKey && !e.metaKey

/**
 * JetBrains-style "tap Shift twice". A tap is a bare Shift press released quickly with nothing else
 * in between, so these never count:
 * - holding Shift, whose OS auto-repeat fires a stream of `repeat` keydowns;
 * - Shift used as a modifier (typing capitals, Shift+Arrow selection, Shift+click);
 * - two separate Shift chords typed in quick succession.
 * The second tap fires on its keyup, once it is known not to have become a chord.
 */
export function createDoubleShiftDetector(
  onDoubleShift: () => void,
  now: () => number = Date.now,
): DoubleShiftDetector {
  let pressedAt = 0
  let chorded = false
  let lastTapAt = 0

  const reset = () => {
    lastTapAt = 0
    chorded = true
  }

  return {
    keydown: (e) => {
      if (e.repeat) return
      if (isBareShift(e)) {
        pressedAt = now()
        chorded = false
        return
      }
      reset()
    },
    keyup: (e) => {
      if (e.key !== 'Shift') return
      const released = now()
      const isTap = pressedAt > 0 && !chorded && released - pressedAt < DOUBLE_SHIFT_INTERVAL_MS
      pressedAt = 0
      if (!isTap) {
        lastTapAt = 0
        return
      }
      if (lastTapAt > 0 && released - lastTapAt < DOUBLE_SHIFT_INTERVAL_MS) {
        lastTapAt = 0
        onDoubleShift()
        return
      }
      lastTapAt = released
    },
    reset,
  }
}
