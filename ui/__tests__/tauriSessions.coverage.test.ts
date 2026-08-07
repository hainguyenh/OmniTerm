import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  channels: [] as Array<{ onmessage?: (message: unknown) => void }>,
}))

class FakeChannel {
  onmessage: ((message: unknown) => void) | undefined
  constructor() {
    state.channels.push(this)
  }
}

vi.mock('@tauri-apps/api/core', () => ({
  Channel: FakeChannel,
  invoke: (...args: unknown[]) => state.invoke(...args),
}))
vi.mock('../diag', () => ({
  diag: { error: vi.fn(), log: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const sessions = await import('../tauriSessions')

beforeEach(() => {
  vi.clearAllMocks()
  state.channels.length = 0
  state.invoke.mockResolvedValue(undefined)
  sessions.__resetSessionsForTests()
})

function channels() {
  expect(state.channels).toHaveLength(2)
  return { data: state.channels[0], status: state.channels[1] }
}

describe('session channel edge behavior', () => {
  it('decodes a view using its byte offset and dispatches activity/default status fields', async () => {
    const data: number[][] = []
    const ready: Array<string | undefined> = []
    const closed: number[] = []
    const activity: boolean[] = []
    sessions.onSession('s1', 'data', (bytes) => data.push([...bytes]))
    sessions.onSession('s1', 'ready', (label) => ready.push(label))
    sessions.onSession('s1', 'closed', (code) => closed.push(code))
    sessions.onSession('s1', 'activity', (busy) => activity.push(busy))

    await sessions.startSession('s1', 'c1')
    const { data: dataChannel, status } = channels()
    const source = new Uint8Array([9, 1, 2, 8])
    dataChannel.onmessage?.(new Uint8Array(source.buffer, 1, 2))
    status.onmessage?.({ kind: 'ready', label: null })
    status.onmessage?.({ kind: 'closed', code: null })
    status.onmessage?.({ kind: 'activity', busy: 1 })
    status.onmessage?.({ kind: 'activity', busy: 0 })

    expect(data).toEqual([[1, 2]])
    expect(ready).toEqual([undefined])
    expect(closed).toEqual([0])
    expect(activity).toEqual([true, false])
  })

  it('ignores stale or duplicate cleanup and removes the final session entry', () => {
    const old = vi.fn()
    const replacement = vi.fn()
    const offOld = sessions.onSession('s1', 'error', old)
    const offNew = sessions.onSession('s1', 'error', replacement)
    offOld()
    sessions.failSession('s1', 'first')
    expect(old).not.toHaveBeenCalled()
    expect(replacement).toHaveBeenCalledWith('first')
    offNew()
    offNew()
    sessions.failSession('s1', 'second')
    expect(replacement).toHaveBeenCalledTimes(1)
  })

  it('returns the attach snapshot and reports attach rejection through the session error handler', async () => {
    const errors: string[] = []
    sessions.onSession('s1', 'error', (message) => errors.push(message))
    state.invoke.mockResolvedValueOnce({ status: 'ready', label: 'bash', busy: false })
    await expect(sessions.attachSession('s1')).resolves.toEqual({
      status: 'ready',
      label: 'bash',
      busy: false,
    })
    expect(state.invoke.mock.calls[0][0]).toBe('attach_session')

    state.channels.length = 0
    state.invoke.mockRejectedValueOnce(new Error('session vanished'))
    await expect(sessions.attachSession('s1')).resolves.toBeNull()
    expect(errors).toEqual(['Error: session vanished'])
  })

  it('routes explicit error messages and converts start rejection to text', async () => {
    const errors: string[] = []
    sessions.onSession('s1', 'error', (message) => errors.push(message))
    await sessions.startSession('s1', 'c1', 'bash')
    channels().status.onmessage?.({ kind: 'error', message: 'reader failed' })

    state.channels.length = 0
    state.invoke.mockRejectedValueOnce({ reason: 'no pty' })
    await sessions.startSession('s1', 'c1')
    expect(errors).toEqual(['reader failed', '[object Object]'])
  })
})
