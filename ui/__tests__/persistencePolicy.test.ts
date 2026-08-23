/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getPersistencePolicy,
  isPersistencePolicy,
  setPersistencePolicyOverride,
} from '../utils/persistencePolicy'

describe('persistencePolicy', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('accepts freeze-while-closed as an override', () => {
    setPersistencePolicyOverride('tab-9', 'freeze-while-closed')
    expect(getPersistencePolicy('tab-9')).toBe('freeze-while-closed')
  })

  it('defaults every terminal to close-with-app', () => {
    expect(getPersistencePolicy('tab-shell')).toBe('close-with-app')
    expect(getPersistencePolicy('tab-agent')).toBe('close-with-app')
  })

  it('validates policy values strictly', () => {
    expect(isPersistencePolicy('freeze-while-closed')).toBe(true)
    expect(isPersistencePolicy('freeze')).toBe(false)
    expect(isPersistencePolicy(null)).toBe(false)
  })
})
