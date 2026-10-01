import { describe, expect, it } from 'vitest'

import { planTrustAnswer } from '../trustDialog'
import { PERMISSIONS_TRUST, PERMISSIONS_TRUST_ON_YES } from './trustScreens'

describe('planTrustAnswer', () => {
  it('walks down to "Yes, I trust this folder" when the cursor sits on "No, exit" (regression)', () => {
    expect(planTrustAnswer(PERMISSIONS_TRUST)).toEqual({ kind: 'arrows', moves: 1 })
  })

  it('confirms in place once the cursor is on the Yes option', () => {
    expect(planTrustAnswer(PERMISSIONS_TRUST_ON_YES)).toEqual({ kind: 'arrows', moves: 0 })
  })

  it('walks up when Yes is listed above the cursor', () => {
    expect(planTrustAnswer(['Trust this folder?', '  Yes, trust this folder', '❯ No, exit'])).toEqual({ kind: 'arrows', moves: -1 })
  })

  it('uses the digit of a numbered Yes option', () => {
    expect(planTrustAnswer(['Do you trust the files in this folder?', '❯ 1. Yes, proceed', '  2. No, exit'])).toEqual({ kind: 'number', key: '1' })
    expect(planTrustAnswer(['[1] Yes, trust this folder (default)', '[2] No, exit'])).toEqual({ kind: 'number', key: '1' })
    expect(planTrustAnswer(['Trust this folder?', '❯ 1. No, exit', '  2. Yes, trust this folder'])).toEqual({ kind: 'number', key: '2' })
  })

  it('does not answer when there is no Yes option', () => {
    expect(planTrustAnswer(['Do you trust this folder?', '❯ No, exit', '  Cancel'])).toBeNull()
    expect(planTrustAnswer(['Do you trust this folder?'])).toBeNull()
  })
})
