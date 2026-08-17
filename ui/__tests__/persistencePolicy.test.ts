import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPersistencePolicy,
  hasExplicitPersistencePolicy,
  setPersistencePolicyOverride,
} from '../utils/persistencePolicy'

describe('terminal persistence policy', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('defaults agents to reboot recovery and ordinary terminals to keep-running', () => {
    expect(getPersistencePolicy('agent-1', true)).toBe('recover-after-reboot')
    expect(getPersistencePolicy('shell-1', false)).toBe('keep-running')
  })

  it('persists an explicit per-session override', () => {
    setPersistencePolicyOverride('agent-1', 'close-with-app')
    expect(hasExplicitPersistencePolicy('agent-1')).toBe(true)
    expect(getPersistencePolicy('agent-1', true)).toBe('close-with-app')
  })
})
