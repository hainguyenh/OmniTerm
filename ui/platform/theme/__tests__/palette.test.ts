import { describe, expect, it } from 'vitest'

import { TOKYO_NIGHT, type AppTheme } from '../../../themes'
import { omniPaletteCss, paletteFor } from '../palette'

const hostile = (): AppTheme => {
  const theme: AppTheme = JSON.parse(JSON.stringify(TOKYO_NIGHT))
  theme.terminal.dark.red = 'red; } body { display:none } :root {'
  theme.terminal.dark.green = 'url(http://evil/x)'
  theme.ui.dark.accent = '#fff;--x:1'
  theme.ui.dark.error = '</style><script>alert(1)</script>'
  return theme
}

describe('paletteFor', () => {
  it('maps the theme onto the tokens.css palette roles', () => {
    const palette = paletteFor(TOKYO_NIGHT, 'dark')
    expect(palette['--palette-bg']).toBe(TOKYO_NIGHT.terminal.dark.background.toLowerCase())
    expect(palette['--palette-accent']).toBe(TOKYO_NIGHT.ui.dark.accent.toLowerCase())
    expect(palette['--palette-ansi-bright-black']).toMatch(/^#[0-9a-f]{6}$/)
    expect(Object.keys(palette)).toContain('--palette-ansi-bright-white')
  })

  it('uses the mode asked for', () => {
    expect(paletteFor(TOKYO_NIGHT, 'light')['--palette-bg']).toBe(TOKYO_NIGHT.terminal.light.background.toLowerCase())
  })

  it('only ever emits opaque hex values', () => {
    for (const mode of ['dark', 'light'] as const)
      for (const value of Object.values(paletteFor(TOKYO_NIGHT, mode))) expect(value).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('omniPaletteCss', () => {
  it('scopes the palette to the omniterm colour theme', () => {
    const css = omniPaletteCss(TOKYO_NIGHT, 'dark')
    expect(css.startsWith(':root[data-color-theme="omniterm"][data-theme] {')).toBe(true)
    expect(css).toContain('color-scheme: dark;')
  })

  it('never lets theme text reach the stylesheet', () => {
    const css = omniPaletteCss(hostile(), 'dark')
    for (const bad of ['evil', 'display', 'script', 'url(', '<', 'red;', '--x:1']) expect(css).not.toContain(bad)
    // Every declaration is a custom property set to a plain hex colour.
    const lines = css.split('\n').slice(1, -2).filter((l) => !l.includes('color-scheme'))
    for (const line of lines) expect(line).toMatch(/^ {2}--[a-z-]+: #[0-9a-f]{6};$/)
  })

  it('falls back to defaults for a theme without a ui block', () => {
    const bare = { ...TOKYO_NIGHT, ui: undefined } as unknown as AppTheme
    expect(omniPaletteCss(bare, 'light')).toContain('--palette-panel: #')
  })
})
