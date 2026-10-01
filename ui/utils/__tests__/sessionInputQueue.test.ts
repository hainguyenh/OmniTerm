import { afterEach, describe, expect, it, vi } from 'vitest'

import { sendInOrder } from '../sessionInputQueue'

/** A send the test answers by hand, recording when it started. */
function deferredSend(log: string[], name: string) {
  let answer: (ok: boolean) => void = () => {}
  const send = vi.fn(() => {
    log.push(`start ${name}`)
    return new Promise<void>((resolve, reject) => {
      answer = (ok) => (ok ? resolve() : reject(new Error('pipe busy')))
    })
  })
  return { send, answer: (ok = true) => answer(ok) }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.useRealTimers()
})

// Regression: back-to-back keystrokes went out as concurrent backend calls and could be written to
// the PTY in either order — a Telex Backspace landing after its corrected letter garbled the line.
describe('sendInOrder', () => {
  it('starts a pane\'s next chunk only once the previous one was written, unchanged', async () => {
    const log: string[] = []
    const first = deferredSend(log, 'tie')
    const second = deferredSend(log, 'DEL ê')
    void sendInOrder('s1', first.send)
    const done = sendInOrder('s1', second.send)
    await flush()
    expect(log).toEqual(['start tie'])

    first.answer()
    await flush()
    expect(log).toEqual(['start tie', 'start DEL ê'])
    second.answer()
    await expect(done).resolves.toBeUndefined()
  })

  it('carries on after a failed chunk, and never holds another pane back', async () => {
    const log: string[] = []
    const failing = deferredSend(log, 'a')
    const after = deferredSend(log, 'b')
    const other = deferredSend(log, 'other pane')
    void sendInOrder('s1', failing.send)
    void sendInOrder('s1', after.send)
    void sendInOrder('s2', other.send)
    await flush()
    expect(log).toEqual(['start a', 'start other pane'])

    failing.answer(false)
    await flush()
    expect(log).toContain('start b')
  })

  it('stops waiting on a chunk the backend never answers', async () => {
    vi.useFakeTimers()
    const log: string[] = []
    const stuck = deferredSend(log, 'stuck')
    const next = deferredSend(log, 'next')
    void sendInOrder('s3', stuck.send)
    void sendInOrder('s3', next.send)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(log).toEqual(['start stuck'])
    await vi.advanceTimersByTimeAsync(1)
    expect(log).toEqual(['start stuck', 'start next'])
  })
})
