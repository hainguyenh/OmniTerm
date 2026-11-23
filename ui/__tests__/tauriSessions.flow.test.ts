import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  ack: vi.fn(),
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
vi.mock('../sessionOutputAck', () => ({ ackSessionOutput: state.ack }))
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

/** Start a session and return the data channel the backend would stream on. */
async function dataChannel(id = 's1') {
  await sessions.startSession(id, 'c1')
  return state.channels[state.channels.length - 2]
}

describe('session output acknowledgement', () => {
  it('acknowledges output as soon as a plain handler returns', async () => {
    sessions.onSession('s1', 'data', () => {})
    const channel = await dataChannel()
    channel.onmessage?.(new Uint8Array(12))
    expect(state.ack).toHaveBeenCalledWith('s1', 12)
  })

  it('leaves it to a handler that acknowledges once it has written the bytes', async () => {
    sessions.onSession('s1', 'data', () => sessions.ACK_LATER)
    const channel = await dataChannel()
    channel.onmessage?.(new Uint8Array(12))
    expect(state.ack).not.toHaveBeenCalled()
  })

  it('acknowledges output nothing is listening to, so the session keeps streaming', async () => {
    const channel = await dataChannel()
    channel.onmessage?.(new Uint8Array(5))
    expect(state.ack).toHaveBeenCalledWith('s1', 5)
  })

  it('does not credit the newer stream with output of the one it replaced', async () => {
    sessions.onSession('s1', 'data', () => {})
    const old = await dataChannel()
    await dataChannel()
    old.onmessage?.(new Uint8Array(9))
    expect(state.ack).not.toHaveBeenCalled()
  })
})
