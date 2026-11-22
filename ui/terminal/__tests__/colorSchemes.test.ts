import { describe, expect, it } from 'vitest'

import { COLOR_SCHEMES, findColorScheme, FOLLOW_THEME, paletteOf } from '../colorSchemes'

const HEX = /^#[0-9a-f]{6}$/

describe('COLOR_SCHEMES', () => {
  it('has unique ids and complete, valid palettes', () => {
    expect(new Set(COLOR_SCHEMES.map(s => s.id)).size).toBe(COLOR_SCHEMES.length)
    for (const { id, colors } of COLOR_SCHEMES) {
      for (const [key, value] of Object.entries(colors)) {
        if (key === 'selectionForeground') continue
        expect(value, `${id}.${key}`).toMatch(HEX)
      }
    }
  })

  it('includes light and dark presets', () => {
    expect(COLOR_SCHEMES.map(s => s.id)).toEqual(expect.arrayContaining(['iterm2-default', 'dracula', 'solarized-light']))
  })
})

describe('paletteOf', () => {
  it('maps the 16 ANSI colors in index order and falls back to the foreground', () => {
    const palette = paletteOf(
      { background: '#000000', foreground: '#ffffff', cursor: '#cccccc', selection: '#333333' },
      ['#000001', '#000002'],
    )
    expect(palette.black).toBe('#000001')
    expect(palette.red).toBe('#000002')
    expect(palette.brightWhite).toBe('#ffffff')
    expect(palette.cursorAccent).toBe('#000000')
    expect(palette.selectionBackground).toBe('#333333')
  })
})

describe('findColorScheme', () => {
  const custom = [{ id: 'custom:mine', name: 'Mine', colors: COLOR_SCHEMES[0]!.colors }]

  it('finds presets and imported schemes', () => {
    expect(findColorScheme('dracula')?.name).toBe('Dracula')
    expect(findColorScheme('custom:mine', custom)?.name).toBe('Mine')
  })

  it('returns nothing for the theme, unknown ids and presets spelled as custom ones', () => {
    expect(findColorScheme(FOLLOW_THEME)).toBeUndefined()
    expect(findColorScheme('nope')).toBeUndefined()
    expect(findColorScheme('custom:dracula')).toBeUndefined()
  })
})
