/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mockOmnitermAPI } from '../testUtils'
import { SMART_COLOR_MAX_CHARS_PER_SEC } from '../utils/scrollbackBuffer'
import { attach, bytes, written } from './terminalStreamHarness'

beforeEach(() => {
  mockOmnitermAPI()
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => vi.useRealTimers())

describe('attachTerminalStream — output floods', () => {
  it('writes a flood as it came and colours again once the stream slows down', () => {
    const { term, fire } = attach({ smartColors: () => true })
    const line = 'error 404\n'
    fire.data?.(bytes(line))
    const coloured = written(term)
    expect(coloured).not.toBe(line)

    // More than a second's worth of output within the same second.
    fire.data?.(bytes('x'.repeat(SMART_COLOR_MAX_CHARS_PER_SEC)))
    term.write.mockClear()
    fire.data?.(bytes(line))
    expect(written(term)).toBe(line)

    vi.advanceTimersByTime(1_000)
    term.write.mockClear()
    fire.data?.(bytes(line))
    expect(written(term)).toBe(coloured)
  })
})
