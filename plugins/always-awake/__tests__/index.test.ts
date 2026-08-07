import { describe, expect, it, vi } from 'vitest'
import { activate, deactivate, name } from '../src/index'

type InvokeHandler = (method: string, ...args: unknown[]) => unknown

describe('Always Awake plugin', () => {
  it('registers metadata and reports its supported controls', () => {
    let handler: InvokeHandler | undefined
    const log = vi.fn()

    activate({
      registerInvokeHandler: (registered) => { handler = registered },
      services: { log },
    })

    expect(name).toBe('@omniterm/always-awake')
    expect(handler?.('alwaysAwake.info')).toEqual({
      name: 'Always Awake',
      description: 'Prevents Windows sleep for a selected schedule, always or while terminal work is active.',
      modes: ['always', 'activeOnly'],
      durations: ['today', '24h', 'nextMonday'],
    })
    expect(log).toHaveBeenCalledWith('Always Awake activated')
  })

  it('rejects unknown plugin methods and supports clean deactivation', () => {
    let handler: InvokeHandler | undefined
    activate({
      registerInvokeHandler: (registered) => { handler = registered },
      services: { log: vi.fn() },
    })

    expect(() => handler?.('unknown')).toThrow('Unknown Always Awake method "unknown"')
    expect(deactivate()).toBeUndefined()
  })
})
