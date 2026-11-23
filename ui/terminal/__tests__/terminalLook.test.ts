/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'

import { TOKYO_NIGHT } from '../../themes'
import { COLOR_SCHEMES, FOLLOW_THEME } from '../colorSchemes'
import {
  addCustomScheme,
  DEFAULT_TERMINAL_LOOK,
  importItermScheme,
  isLightColor,
  parseTerminalLook,
  removeCustomScheme,
  resolveTerminalLook,
} from '../terminalLook'

const dracula = COLOR_SCHEMES.find(s => s.id === 'dracula')!.colors
const solarizedLight = COLOR_SCHEMES.find(s => s.id === 'solarized-light')!.colors

describe('parseTerminalLook', () => {
  it('falls back to the defaults for missing or malformed settings', () => {
    expect(parseTerminalLook(undefined)).toEqual(DEFAULT_TERMINAL_LOOK)
    expect(parseTerminalLook('x')).toEqual(DEFAULT_TERMINAL_LOOK)
    expect(parseTerminalLook({
      darkScheme: 'no-such-scheme',
      lightScheme: 3,
      minContrast: 'high',
      boldBright: 'yes',
      linkColors: null,
      customSchemes: 'none',
    })).toEqual(DEFAULT_TERMINAL_LOOK)
  })

  it('keeps valid choices and clamps the contrast ratio', () => {
    const look = parseTerminalLook({ darkScheme: 'dracula', lightScheme: 'solarized-light', minContrast: 30, boldBright: false, linkColors: false })
    expect(look).toMatchObject({ darkScheme: 'dracula', lightScheme: 'solarized-light', minContrast: 7, boldBright: false, linkColors: false })
    expect(parseTerminalLook({ minContrast: 0 }).minContrast).toBe(1)
  })

  it('keeps only well-formed imported schemes', () => {
    const look = parseTerminalLook({
      darkScheme: 'custom:ok',
      customSchemes: [
        { id: 'custom:ok', name: ' Mine ', colors: dracula },
        { id: 'custom:ok', name: 'Duplicate', colors: dracula },
        { id: 'dracula', name: 'Not custom', colors: dracula },
        { id: 'custom:bad', name: 'Bad', colors: { ...dracula, red: 'red' } },
        { id: 'custom:noname', name: '', colors: dracula },
      ],
    })
    expect(look.customSchemes.map(s => [s.id, s.name])).toEqual([['custom:ok', 'Mine']])
    expect(look.darkScheme).toBe('custom:ok')
    expect(parseTerminalLook({ darkScheme: 'custom:gone' }).darkScheme).toBe(FOLLOW_THEME)
  })
})

describe('custom schemes', () => {
  it('adds under a unique id, selects it for the mode, and removes it again', () => {
    const one = addCustomScheme(DEFAULT_TERMINAL_LOOK, 'My Scheme!', dracula, 'dark')
    const two = addCustomScheme(one, 'my scheme', dracula, 'light')
    expect(two.customSchemes.map(s => s.id)).toEqual(['custom:my-scheme', 'custom:my-scheme-2'])
    expect(two).toMatchObject({ darkScheme: 'custom:my-scheme', lightScheme: 'custom:my-scheme-2' })
    const removed = removeCustomScheme(two, 'custom:my-scheme')
    expect(removed.customSchemes.map(s => s.id)).toEqual(['custom:my-scheme-2'])
    expect(removed.darkScheme).toBe(FOLLOW_THEME)
    expect(removed.lightScheme).toBe('custom:my-scheme-2')
  })

  it('imports an .itermcolors file for the mode its background suits', () => {
    const c = (v: number) => `<dict><key>Red Component</key><real>${v}</real><key>Green Component</key><real>${v}</real><key>Blue Component</key><real>${v}</real></dict>`
    const entries = Array.from({ length: 16 }, (_, i) => `<key>Ansi ${i} Color</key>${c(i / 15)}`).join('')
    const xml = `<plist version="1.0"><dict>${entries}<key>Background Color</key>${c(1)}<key>Foreground Color</key>${c(0)}</dict></plist>`
    const look = importItermScheme(DEFAULT_TERMINAL_LOOK, 'Paper.itermcolors', xml)
    expect(look?.customSchemes[0]?.name).toBe('Paper')
    expect(look?.lightScheme).toBe('custom:paper')
    expect(look?.darkScheme).toBe(FOLLOW_THEME)
    expect(importItermScheme(DEFAULT_TERMINAL_LOOK, 'x.itermcolors', '<plist/>')).toBeNull()
  })
})

describe('resolveTerminalLook', () => {
  const theme = TOKYO_NIGHT.terminal.dark

  it('follows the theme by default, with contrast correction only on light palettes', () => {
    expect(resolveTerminalLook(undefined, theme, true)).toEqual({
      theme, lightPalette: false, minimumContrastRatio: 1, boldBright: true, linkColors: true, themeColors: true,
    })
    expect(resolveTerminalLook(undefined, theme, false)).toMatchObject({ lightPalette: true, minimumContrastRatio: 2.5 })
  })

  it('uses the scheme of the current mode and judges lightness by its background', () => {
    const settings = { darkScheme: 'solarized-light', lightScheme: 'dracula' }
    expect(resolveTerminalLook(settings, theme, true)).toMatchObject({ theme: solarizedLight, lightPalette: true, minimumContrastRatio: 2.5 })
    expect(resolveTerminalLook(settings, theme, false)).toMatchObject({ theme: dracula, lightPalette: false, minimumContrastRatio: 1 })
  })

  it('applies an explicit contrast ratio and toggles', () => {
    expect(resolveTerminalLook({ minContrast: 4.5, boldBright: false, linkColors: false }, theme, true))
      .toMatchObject({ minimumContrastRatio: 4.5, boldBright: false, linkColors: false })
  })
})

describe('isLightColor', () => {
  it('tells light from dark backgrounds and rejects malformed colors', () => {
    expect(isLightColor('#fdf6e3')).toBe(true)
    expect(isLightColor('#282a36')).toBe(false)
    expect(isLightColor('white')).toBe(false)
  })
})
