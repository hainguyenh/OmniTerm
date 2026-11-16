import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const listen = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: unknown[]) => listen(...args) }))
vi.mock('../../../diag', () => ({ diag: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { diag } from '../../../diag'
import { createAlwaysAwakeAPI } from '../alwaysAwakeAPI'

describe('createAlwaysAwakeAPI', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports the plugin switch, treating any failure as off', async () => {
    const api = createAlwaysAwakeAPI()
    invoke.mockResolvedValueOnce(true)
    await expect(api.info()).resolves.toBe(true)
    invoke.mockResolvedValueOnce('yes')
    await expect(api.info()).resolves.toBe(false)
    invoke.mockRejectedValueOnce(new Error('no command'))
    await expect(api.info()).resolves.toBe(false)
  })

  it('forwards state commands', async () => {
    const api = createAlwaysAwakeAPI()
    invoke.mockResolvedValue({ enabled: true })
    await api.getState()
    expect(invoke).toHaveBeenLastCalledWith('get_state')
    const payload = { enabled: true, mode: 'timed', expiresAtMs: 5 } as never
    await api.setState(payload)
    expect(invoke).toHaveBeenLastCalledWith('set_state', payload)
    await api.disable()
    expect(invoke).toHaveBeenLastCalledWith('disable')
  })

  it('delivers state events until unsubscribed', async () => {
    const unlisten = vi.fn()
    let handler: (event: { payload: unknown }) => void = () => {}
    listen.mockImplementation((_name: string, cb: typeof handler) => {
      handler = cb
      return Promise.resolve(unlisten)
    })
    const callback = vi.fn()
    const stop = createAlwaysAwakeAPI().onState(callback)
    await Promise.resolve()
    handler({ payload: { enabled: false } })
    expect(callback).toHaveBeenCalledWith({ enabled: false })
    stop()
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('releases a listener that resolves after the unsubscribe', async () => {
    const unlisten = vi.fn()
    listen.mockReturnValue(Promise.resolve(unlisten))
    createAlwaysAwakeAPI().onState(vi.fn())()
    await Promise.resolve()
    await Promise.resolve()
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('logs a failed subscription', async () => {
    listen.mockReturnValue(Promise.reject(new Error('denied')))
    createAlwaysAwakeAPI().onState(vi.fn())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(diag.error).toHaveBeenCalled()
  })
})
