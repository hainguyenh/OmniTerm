/** @vitest-environment jsdom */
/**
 * A pane acknowledges the session output it has painted, so the backend stops reading a session
 * whose pane cannot keep up instead of queueing its output in memory (src-tauri/src/pty_flow.rs).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HIDDEN_FLUSH_MS } from '../ide/features/terminal/outputGate'
import { mockOmnitermAPI } from '../testUtils'
import { attach, bytes, makeChannel } from './terminalStreamHarness'

type WriteCallback = (() => void) | undefined

beforeEach(() => {
  mockOmnitermAPI()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** A pane whose xterm parses each write at once, or holds the callbacks until `parse()`. */
function flowPane(options: { visible?: () => boolean; parseAtOnce?: boolean } = {}) {
  const ack = vi.fn()
  const { channel, fire } = makeChannel()
  const pending: WriteCallback[] = []
  const pane = attach({ api: { ...channel, ack }, smartColors: () => false, visible: options.visible })
  pane.term.write.mockImplementation((_data: string, parsed?: () => void) => {
    if (options.parseAtOnce ?? true) parsed?.()
    else pending.push(parsed)
  })
  const parse = () => pending.splice(0).forEach(cb => cb?.())
  return { ...pane, fire, ack, parse }
}

describe('attachTerminalStream — output acknowledgement', () => {
  it('acknowledges output once xterm has parsed the paint that carried it', () => {
    const { fire, ack } = flowPane()
    const data = bytes('hello\r\n')

    expect(fire.data?.(data)).toBe('ack-later')
    expect(ack).toHaveBeenCalledWith(data.byteLength)
  })

  it('does not acknowledge output xterm has not parsed yet', () => {
    const { fire, ack, parse } = flowPane({ parseAtOnce: false })
    fire.data?.(bytes('abc'))
    expect(ack).not.toHaveBeenCalled()

    parse()
    expect(ack).toHaveBeenCalledWith(3)
  })

  it('acknowledges a hidden pane\'s output with the paint that finally writes it', () => {
    const { fire, ack } = flowPane({ visible: () => false })
    fire.data?.(bytes('ab'))
    fire.data?.(bytes('cd'))
    expect(ack).not.toHaveBeenCalled()

    vi.advanceTimersByTime(HIDDEN_FLUSH_MS)
    expect(ack).toHaveBeenCalledTimes(1)
    expect(ack).toHaveBeenCalledWith(4)
  })

  it('releases what it still holds when the pane goes away, and only once', () => {
    const { fire, ack, parse, stream } = flowPane({ parseAtOnce: false })
    fire.data?.(bytes('12345'))

    stream.dispose()
    expect(ack).toHaveBeenCalledWith(5)

    parse()
    expect(ack).toHaveBeenCalledTimes(1)
  })

  it('leaves the acknowledgement to the session layer when the channel has no ack', () => {
    const { fire } = attach({ smartColors: () => false })
    expect(fire.data?.(bytes('x'))).toBeUndefined()
  })
})
