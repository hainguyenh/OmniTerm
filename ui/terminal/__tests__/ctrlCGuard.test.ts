import { beforeEach, describe, expect, it } from 'vitest'

import { forgetCtrlC, onCtrlC, recentlyInterrupted } from '../ctrlCGuard'

describe('ctrlCGuard', () => {
  beforeEach(() => forgetCtrlC('a'))

  it('interrupts on the first press', () => {
    expect(onCtrlC('a', 1000)).toBe('interrupt')
  })

  it('kills when pressed again within the double-press window', () => {
    onCtrlC('a', 1000)
    expect(onCtrlC('a', 1400)).toBe('kill')
  })

  it('treats a slow second press as a new interrupt', () => {
    onCtrlC('a', 1000)
    expect(onCtrlC('a', 1600)).toBe('interrupt')
  })

  it('does not mix sessions', () => {
    onCtrlC('a', 1000)
    expect(onCtrlC('b', 1100)).toBe('interrupt')
    forgetCtrlC('b')
  })

  it('reports a recent interrupt only inside the exit window', () => {
    onCtrlC('a', 1000)
    expect(recentlyInterrupted('a', 3500)).toBe(true)
    expect(recentlyInterrupted('a', 4500)).toBe(false)
    expect(recentlyInterrupted('zzz', 1000)).toBe(false)
  })
})
