import { describe, expect, it, vi } from 'vitest'
import { activate, deactivate, name } from '../src/index'

type InvokeHandler = (method: string, ...args: unknown[]) => unknown

describe('Blur plugin', () => {
  it('registers metadata and reports slider limits', () => {
    let handler: InvokeHandler | undefined
    const log = vi.fn()

    activate({
      registerInvokeHandler: registered => { handler = registered },
      services: { log },
    })

    expect(name).toBe('@omniterm/blur')
    expect(handler?.('blur.info')).toEqual({
      name: 'Blur',
      description: 'Softly blurs OmniTerm windows while they are inactive.',
      min: 0,
      max: 16,
      step: 1,
    })
    expect(log).toHaveBeenCalledWith('Blur activated')
  })

  it('rejects unknown methods and deactivates cleanly', () => {
    let handler: InvokeHandler | undefined
    activate({ registerInvokeHandler: registered => { handler = registered }, services: { log: vi.fn() } })

    expect(() => handler?.('unknown')).toThrow('Unknown Blur method "unknown"')
    expect(deactivate()).toBeUndefined()
  })
})
