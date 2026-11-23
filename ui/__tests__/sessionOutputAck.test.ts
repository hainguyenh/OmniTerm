import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

const { ackSessionOutput, __resetOutputAckForTests } = await import('../sessionOutputAck')

beforeEach(() => {
  vi.useFakeTimers()
  invoke.mockReset()
  invoke.mockResolvedValue(undefined)
  __resetOutputAckForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ackSessionOutput', () => {
  it('reports small writes of a session together, once, shortly after', () => {
    ackSessionOutput('a', 100)
    ackSessionOutput('a', 50)
    ackSessionOutput('b', 7)
    expect(invoke).not.toHaveBeenCalled()

    vi.advanceTimersByTime(50)
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenCalledWith('ack_session_output', { id: 'a', bytes: 150 })
    expect(invoke).toHaveBeenCalledWith('ack_session_output', { id: 'b', bytes: 7 })
  })

  it('reports a large amount at once instead of waiting', () => {
    ackSessionOutput('a', 200 * 1024)
    ackSessionOutput('a', 100 * 1024)
    expect(invoke).toHaveBeenCalledWith('ack_session_output', { id: 'a', bytes: 300 * 1024 })

    vi.advanceTimersByTime(50)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('ignores nothing-written reports', () => {
    ackSessionOutput('a', 0)
    vi.advanceTimersByTime(50)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('survives the backend rejecting a report', async () => {
    invoke.mockRejectedValue(new Error('gone'))
    ackSessionOutput('a', 300 * 1024)
    await vi.runAllTimersAsync()
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
