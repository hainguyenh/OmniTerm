import { describe, expect, it } from 'vitest'

import { TOKYO_NIGHT } from '../../../themes'
import { WORKBENCH_THEME_ID } from '../choice'
import { appThemeFromTokens } from '../workbenchTheme'

describe('appThemeFromTokens', () => {
  it('restates the tokens as an OmniTerm theme', () => {
    const tokens: Record<string, string> = {
      '--bg-app': '#fdf6e3',
      '--fg': '#657b83',
      '--terminal-ansi-red': '#dc322f',
      '--accent': '#268bd2',
    }
    const theme = appThemeFromTokens((name) => tokens[name] ?? null, 'light')
    expect(theme.id).toBe(WORKBENCH_THEME_ID)
    expect(theme.terminal.light.background).toBe('#fdf6e3')
    expect(theme.terminal.light.foreground).toBe('#657b83')
    expect(theme.terminal.light.red).toBe('#dc322f')
    expect(theme.ui.light.accent).toBe('#268bd2')
    expect(theme.terminal.dark).toBe(theme.terminal.light)
  })

  it('keeps a usable theme when tokens are missing', () => {
    const theme = appThemeFromTokens(() => null, 'dark')
    expect(theme.terminal.dark.background).toBe(TOKYO_NIGHT.terminal.dark.background)
    expect(theme.ui.dark.fontFamily).toBe(TOKYO_NIGHT.ui.dark.fontFamily)
  })
})
