/** @vitest-environment jsdom */
/**
 * Session panes paint through the shared output gate: a hidden pane (another tab, a background
 * window) holds its output and paints it at most every 250 ms, and the pane on screen writes every
 * chunk at once — so typing, and clicking an option an agent offers, are never delayed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HIDDEN_FLUSH_MS } from '../ide/features/terminal/outputGate'
import { mockOmnitermAPI } from '../testUtils'
import { attach, bytes, written } from './terminalStreamHarness'

beforeEach(() => {
  mockOmnitermAPI()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('attachTerminalStream — paint rate', () => {
  it('writes the shown pane\'s output at once', () => {
    const { term, fire } = attach({ smartColors: () => false, visible: () => true })
    fire.data?.(bytes('❯ 1. Yes\r\n'))
    expect(written(term)).toBe('❯ 1. Yes\r\n')
  })

  it('holds a hidden pane\'s output and paints it in one write per interval', () => {
    const { term, fire } = attach({ smartColors: () => false, visible: () => false })
    fire.data?.(bytes('⠋ Thinking'))
    fire.data?.(bytes('\r⠙ Thinking'))
    expect(written(term)).toBe('')
    vi.advanceTimersByTime(HIDDEN_FLUSH_MS)
    expect(term.write).toHaveBeenCalledTimes(1)
    expect(written(term)).toBe('⠋ Thinking\r⠙ Thinking')
  })

  it('paints what a hidden pane held as soon as it is shown', () => {
    let shown = false
    const { term, fire, stream } = attach({ smartColors: () => false, visible: () => shown })
    fire.data?.(bytes('while away\r\n'))
    expect(written(term)).toBe('')
    shown = true
    stream.visibilityChanged()
    expect(written(term)).toBe('while away\r\n')
  })

  it('keeps a banner written by the pane after the output held before it', () => {
    const { term, fire, stream } = attach({ smartColors: () => false, visible: () => false })
    fire.data?.(bytes('last line\r\n'))
    stream.write('[exited]\r\n')
    vi.advanceTimersByTime(HIDDEN_FLUSH_MS)
    expect(written(term)).toBe('last line\r\n[exited]\r\n')
  })

  it('paints held output when the pane goes away', () => {
    const { term, fire, stream } = attach({ smartColors: () => false, visible: () => false })
    fire.data?.(bytes('tail'))
    stream.dispose()
    expect(written(term)).toBe('tail')
  })
})
