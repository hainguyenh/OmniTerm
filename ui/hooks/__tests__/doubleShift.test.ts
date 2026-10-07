/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'

import { createDoubleShiftDetector } from '../doubleShift'

const key = (type: 'keydown' | 'keyup', k: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent(type, { key: k, ...init })

/** A detector on a hand-driven clock, plus a `tap` helper that presses and releases Shift. */
function setup() {
  let clock = 1000
  const onDoubleShift = vi.fn()
  const detector = createDoubleShiftDetector(onDoubleShift, () => clock)
  const advance = (ms: number) => { clock += ms }
  const tap = (holdMs = 50) => {
    detector.keydown(key('keydown', 'Shift', { shiftKey: true }))
    advance(holdMs)
    detector.keyup(key('keyup', 'Shift'))
  }
  return { detector, onDoubleShift, advance, tap }
}

describe('createDoubleShiftDetector', () => {
  it('fires on two quick Shift taps', () => {
    const { onDoubleShift, advance, tap } = setup()
    tap()
    advance(100)
    tap()
    expect(onDoubleShift).toHaveBeenCalledTimes(1)
  })

  it('does not fire on a single Shift tap', () => {
    const { onDoubleShift, tap } = setup()
    tap()
    expect(onDoubleShift).not.toHaveBeenCalled()
  })

  // Regression: holding Shift auto-repeats keydown, which used to open Search Everywhere.
  it('ignores auto-repeat keydowns while Shift is held', () => {
    const { detector, onDoubleShift, advance } = setup()
    detector.keydown(key('keydown', 'Shift', { shiftKey: true }))
    for (let i = 0; i < 10; i++) {
      advance(30)
      detector.keydown(key('keydown', 'Shift', { shiftKey: true, repeat: true }))
    }
    detector.keyup(key('keyup', 'Shift'))
    expect(onDoubleShift).not.toHaveBeenCalled()
  })

  it('does not count a long Shift hold as a tap', () => {
    const { onDoubleShift, advance, tap } = setup()
    tap(600)
    advance(50)
    tap()
    expect(onDoubleShift).not.toHaveBeenCalled()
  })

  it('does not fire when the taps are too far apart', () => {
    const { onDoubleShift, advance, tap } = setup()
    tap()
    advance(500)
    tap()
    expect(onDoubleShift).not.toHaveBeenCalled()
  })

  it('does not fire when Shift is used as a modifier for typing', () => {
    const { detector, onDoubleShift, advance } = setup()
    for (const letter of ['A', 'B']) {
      detector.keydown(key('keydown', 'Shift', { shiftKey: true }))
      detector.keydown(key('keydown', letter, { shiftKey: true }))
      advance(20)
      detector.keyup(key('keyup', 'Shift'))
      advance(20)
    }
    expect(onDoubleShift).not.toHaveBeenCalled()
  })

  it('does not fire when another key lands between the taps', () => {
    const { detector, onDoubleShift, advance, tap } = setup()
    tap()
    detector.keydown(key('keydown', 'a'))
    advance(20)
    tap()
    expect(onDoubleShift).not.toHaveBeenCalled()
  })

  it('does not fire across a Shift+click', () => {
    const { detector, onDoubleShift, advance, tap } = setup()
    tap()
    advance(20)
    detector.keydown(key('keydown', 'Shift', { shiftKey: true }))
    detector.reset()
    detector.keyup(key('keyup', 'Shift'))
    expect(onDoubleShift).not.toHaveBeenCalled()
  })

  it('ignores Shift pressed together with Ctrl', () => {
    const { detector, onDoubleShift } = setup()
    for (let i = 0; i < 2; i++) {
      detector.keydown(key('keydown', 'Shift', { shiftKey: true, ctrlKey: true }))
      detector.keyup(key('keyup', 'Shift', { ctrlKey: true }))
    }
    expect(onDoubleShift).not.toHaveBeenCalled()
  })

  it('needs two fresh taps after firing', () => {
    const { onDoubleShift, advance, tap } = setup()
    tap()
    advance(50)
    tap()
    advance(50)
    tap()
    expect(onDoubleShift).toHaveBeenCalledTimes(1)
  })
})
