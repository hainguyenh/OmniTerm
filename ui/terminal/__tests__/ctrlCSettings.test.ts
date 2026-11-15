import { afterEach, describe, expect, it } from 'vitest'

import { onCtrlC, recentlyInterrupted } from '../ctrlCGuard'
import { DEFAULT_CTRL_C, parseCtrlCSettings, setCtrlCSettings } from '../ctrlCSettings'

afterEach(() => setCtrlCSettings(undefined))

describe('ctrlCSettings', () => {
  it('falls back to the defaults for missing or malformed values', () => {
    expect(parseCtrlCSettings(undefined)).toEqual(DEFAULT_CTRL_C)
    expect(parseCtrlCSettings('nope')).toEqual(DEFAULT_CTRL_C)
    expect(parseCtrlCSettings({ withSelection: 'paste', doublePress: 1, windowMs: 'x', keepTabSeconds: NaN, showHint: 'yes' }))
      .toEqual(DEFAULT_CTRL_C)
  })

  it('keeps valid values and clamps numbers to their range', () => {
    expect(parseCtrlCSettings({ withSelection: 'interrupt', doublePress: 'none', windowMs: 50, keepTabSeconds: 99.4, showHint: false }))
      .toEqual({ withSelection: 'interrupt', doublePress: 'none', windowMs: 200, keepTabSeconds: 30, showHint: false })
  })

  it('drives the double-press and keep-tab windows of the guard', () => {
    setCtrlCSettings({ windowMs: 1000, keepTabSeconds: 10 })
    onCtrlC('s', 0)
    expect(onCtrlC('s', 900)).toBe('kill')
    onCtrlC('t', 0)
    expect(recentlyInterrupted('t', 9_000)).toBe(true)
    expect(recentlyInterrupted('t', 11_000)).toBe(false)
  })
})
