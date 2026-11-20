import { describe, expect, it } from 'vitest'

import { isSafeThemeId, legacyChoice, omniChoiceId, parseOmniChoice } from '../choice'

describe('omni theme choices', () => {
  it('round-trips a theme id and mode through the picker value', () => {
    const choice = omniChoiceId('tokyo-night', 'light')
    expect(choice).toBe('plugin:omniterm/tokyo-night@light')
    expect(parseOmniChoice(choice)).toEqual({ themeId: 'tokyo-night', mode: 'light' })
  })

  it('leaves the workbench themes and other plugins alone', () => {
    for (const value of ['light', 'dark-hc', 'plugin:other/x@dark', 'plugin:omniterm/x', 'plugin:omniterm/@dark', 42, null]) {
      expect(parseOmniChoice(value)).toBeNull()
    }
  })

  it('rejects hostile theme ids and modes', () => {
    expect(isSafeThemeId('claude')).toBe(true)
    for (const id of ['', '../x', 'a b', 'a;b', 'a"b', '-x', 'x'.repeat(80), 7]) expect(isSafeThemeId(id)).toBe(false)
    expect(parseOmniChoice('plugin:omniterm/a;b@dark')).toBeNull()
    expect(parseOmniChoice('plugin:omniterm/ok@sepia')).toBeNull()
  })

  it('carries an older install theme and mode into a choice', () => {
    expect(legacyChoice('claude', true)).toBe('plugin:omniterm/claude@dark')
    expect(legacyChoice('claude', false)).toBe('plugin:omniterm/claude@light')
    expect(legacyChoice('workbench', false)).toBe('light')
    expect(legacyChoice(undefined, undefined)).toBe('dark')
  })
})
