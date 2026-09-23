import { describe, expect, it, vi } from 'vitest'
import { createLatestResizeQueue } from '../terminalResize'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('createLatestResizeQueue', () => {
  it('serializes resizes and sends the latest pending size after the current one', async () => {
    const first = deferred()
    const send = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined)
    const queue = createLatestResizeQueue(send)

    queue.push({ cols: 100, rows: 30 })
    queue.push({ cols: 120, rows: 30 })
    queue.push({ cols: 140, rows: 32 })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenLastCalledWith({ cols: 100, rows: 30 })

    first.resolve()
    await first.promise
    await Promise.resolve()

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith({ cols: 140, rows: 32 })
  })

  it('does not send a pending resize after cancellation', async () => {
    const first = deferred()
    const send = vi.fn().mockReturnValue(first.promise)
    const queue = createLatestResizeQueue(send)

    queue.push({ cols: 100, rows: 30 })
    queue.push({ cols: 120, rows: 30 })
    queue.cancel()
    first.resolve()
    await first.promise
    await Promise.resolve()

    expect(send).toHaveBeenCalledTimes(1)
  })
})
