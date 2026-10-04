/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useWorkerTask } from '../useWorkerTask'
import { isWorkerResponse, respond, type WorkerHandler } from '../workerProtocol'

/** A worker that answers through `handler` when told to, or never. */
class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = []
  terminated = false
  posted: unknown[] = []
  constructor(private readonly handler: WorkerHandler<unknown> | null) {
    super()
    FakeWorker.instances.push(this)
  }
  postMessage(data: unknown) {
    this.posted.push(data)
  }
  reply(index = this.posted.length - 1) {
    if (!this.handler) return
    const { message } = respond(this.posted[index], this.handler)
    this.dispatchEvent(new MessageEvent('message', { data: message }))
  }
  fail() {
    this.dispatchEvent(new Event('error'))
  }
  terminate() {
    this.terminated = true
  }
}

const double: WorkerHandler<number> = (payload) => {
  if (typeof payload !== 'number') throw new Error('not a number')
  return { result: payload * 2 }
}

const asWorker = (worker: FakeWorker) => worker as unknown as Worker

afterEach(() => {
  FakeWorker.instances = []
  vi.useRealTimers()
})

describe('workerProtocol', () => {
  it('wraps results and errors with the request id', () => {
    expect(respond({ id: 3, payload: 2 }, double).message).toEqual({ id: 3, ok: true, result: 4 })
    expect(respond({ id: 4, payload: 'x' }, double).message).toEqual({ id: 4, ok: false, error: 'not a number' })
    expect(respond('junk', double).message).toEqual({ id: -1, ok: false, error: 'Malformed preview request' })
    expect(respond({ id: 5, payload: 1 }, () => { throw 'plain' }).message).toEqual({ id: 5, ok: false, error: 'plain' })
    expect(isWorkerResponse({ id: 1, ok: true })).toBe(true)
    expect(isWorkerResponse({ id: '1', ok: true })).toBe(false)
  })
})

describe('useWorkerTask', () => {
  it('runs on the worker and keeps only the latest answer', async () => {
    const create = () => asWorker(new FakeWorker(double))
    const { result, rerender } = renderHook(({ payload }) => useWorkerTask(create, double, payload, { size: 1 }), {
      initialProps: { payload: 1 as number | null },
    })
    expect(result.current.state.status).toBe('running')
    const first = FakeWorker.instances[0]
    // A newer request while the first is still busy replaces the worker.
    rerender({ payload: 5 })
    expect(first.terminated).toBe(true)
    const second = FakeWorker.instances[1]
    act(() => first.reply(0))
    expect(result.current.state.result).toBeNull()
    act(() => second.reply())
    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'done', result: 10, input: 5 }))
    // An idle worker is reused for the next request.
    rerender({ payload: 7 })
    expect(FakeWorker.instances).toHaveLength(2)
    act(() => second.reply())
    await waitFor(() => expect(result.current.state.result).toBe(14))
  })

  it('surfaces handler errors, worker crashes and timeouts, and can retry', async () => {
    vi.useFakeTimers()
    const create = () => asWorker(new FakeWorker(double))
    const { result } = renderHook(() => useWorkerTask(create, double, 'bad' as unknown, { size: 1, timeoutMs: 100 }))
    act(() => FakeWorker.instances[0].reply())
    expect(result.current.state).toMatchObject({ status: 'error', error: 'not a number' })

    act(() => result.current.retry())
    act(() => FakeWorker.instances[0].fail())
    expect(result.current.state.error).toBe('Preview failed to render.')

    act(() => result.current.retry())
    act(() => { vi.advanceTimersByTime(150) })
    expect(result.current.state.error).toMatch(/too long/)
    expect(FakeWorker.instances.at(-1)?.terminated).toBe(true)
  })

  it('falls back to the main thread for small inputs when workers are unavailable', () => {
    const create = () => { throw new Error('no workers') }
    const small = renderHook(() => useWorkerTask(create, double, 4, { size: 10 }))
    expect(small.result.current.state).toMatchObject({ status: 'done', result: 8 })
    const large = renderHook(() => useWorkerTask(create, double, 4, { size: 10 * 1024 * 1024 }))
    expect(large.result.current.state.error).toMatch(/background worker/)
  })

  it('does nothing without a payload and terminates the worker on unmount', () => {
    const create = vi.fn(() => asWorker(new FakeWorker(double)))
    const idle = renderHook(() => useWorkerTask(create, double, null, { size: 0 }))
    expect(idle.result.current.state.status).toBe('idle')
    expect(create).not.toHaveBeenCalled()
    const busy = renderHook(() => useWorkerTask(create, double, 1, { size: 1 }))
    busy.unmount()
    expect(FakeWorker.instances[0].terminated).toBe(true)
  })
})
