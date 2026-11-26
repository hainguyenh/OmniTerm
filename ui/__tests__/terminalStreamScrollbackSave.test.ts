/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mockOmnitermAPI } from '../testUtils'
import { SCROLLBACK_SAVE_MS } from '../utils/terminalStream'
import { attach, bytes } from './terminalStreamHarness'

const store = vi.hoisted(() => ({ save: vi.fn() }))

vi.mock('../utils/scrollbackStore', () => ({
  MAX_SCROLLBACK_BYTES: 512 * 1024,
  loadScrollback: vi.fn(async () => null),
  saveScrollback: store.save,
}))

beforeEach(() => {
  mockOmnitermAPI()
  vi.useFakeTimers()
  store.save.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('attachTerminalStream — scrollback saves', () => {
  it('saves a pane that never stops printing once per interval, not on every chunk', () => {
    const { fire } = attach({ smartColors: () => false, mode: 'attach', scrollbackKey: 'sb-1' })
    for (let tick = 0; tick < 30; tick += 1) {
      fire.data?.(bytes('\r⠋ Thinking'))
      vi.advanceTimersByTime(1_000)
    }
    expect(SCROLLBACK_SAVE_MS).toBeGreaterThanOrEqual(15_000)
    expect(store.save).toHaveBeenCalledTimes(2)
  })

  it('still saves what is new when the pane goes away', () => {
    const { fire, stream } = attach({ smartColors: () => false, mode: 'attach', scrollbackKey: 'sb-1' })
    fire.data?.(bytes('last words'))
    stream.dispose()
    expect(store.save).toHaveBeenCalledWith('sb-1', 'last words')
  })
})
