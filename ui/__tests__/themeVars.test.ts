/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { TOKYO_NIGHT, type AppTheme } from '../themes'
import {
  APP_COLOR_FIELDS,
  DEFAULT_MONO_STACK,
  LIGHT_ONLY_TERMINAL_FIELD,
  TERMINAL_COLOR_FIELDS,
  applyThemeVars,
  isColorLight,
  isSquareTheme,
  readColorField,
  resolvedColorField,
  themeCssVars,
} from '../utils/themeVars'

/**
 * `themeCssVars` is the single mapping behind both the live app and the Theme Remix preview, so these
 * tests pin the contract both sides rely on: every variable the CSS names is produced, and a theme that
 * omits the optional colours still gets exactly what the app used to hardcode.
 */

const withoutUi = (): AppTheme => ({
  id: 'legacy-theme',
  name: 'Legacy',
  terminal: { dark: { ...TOKYO_NIGHT.terminal.dark }, light: { ...TOKYO_NIGHT.terminal.light } },
  ui: undefined as unknown as AppTheme['ui'],
})

describe('themeCssVars', () => {
  it('maps a full theme onto every variable the stylesheet reads', () => {
    const vars = themeCssVars(TOKYO_NIGHT, 'dark')
    for (const name of [
      '--theme-bg', '--theme-fg', '--theme-border', '--theme-selection', '--theme-selection-fg',
      '--theme-hover-bg', '--theme-overlay', '--theme-warning', '--theme-error', '--theme-success',
      '--theme-sidebar-bg', '--theme-popup-bg', '--theme-card-bg', '--theme-accent', '--theme-accent-fg',
      '--theme-dim', '--theme-font-family', '--theme-font-mono',
      '--theme-rounded-sm', '--theme-rounded-md', '--theme-rounded-lg', '--theme-rounded-xl',
      '--theme-padding-sm', '--theme-padding-md', '--theme-padding-lg', '--theme-padding-xl',
      '--theme-margin-sm', '--theme-margin-md', '--theme-margin-lg', '--theme-margin-xl',
    ]) {
      expect(vars[name], name).toBeTruthy()
    }
    expect(vars['--theme-bg']).toBe(TOKYO_NIGHT.terminal.dark.background)
    expect(vars['--theme-accent']).toBe(TOKYO_NIGHT.ui.dark.accent)
  })

  it('falls back to the previously hardcoded values when the optional colours are absent', () => {
    const dark = themeCssVars(TOKYO_NIGHT, 'dark')
    const light = themeCssVars(TOKYO_NIGHT, 'light')

    expect(dark['--theme-hover-bg']).toBe('rgba(255, 255, 255, 0.08)')
    expect(light['--theme-hover-bg']).toBe('rgba(0, 0, 0, 0.06)')
    expect(dark['--theme-overlay']).toBe('rgba(15, 23, 42, 0.58)')
    expect(light['--theme-overlay']).toBe('rgba(71, 85, 105, 0.28)')
    expect(dark['--theme-selection-fg']).toBe('#ffffff')
    expect(light['--theme-selection-fg']).toBe(TOKYO_NIGHT.terminal.light.foreground)
    expect(dark['--theme-warning']).toBe('#e0af68')
    expect(dark['--theme-error']).toBe('#f7768e')
    expect(dark['--theme-success']).toBe('#9ece6a')
    expect(dark['--theme-accent-fg']).toBe('var(--theme-bg)')
  })

  it('prefers a theme that does define them', () => {
    const themed: AppTheme = {
      ...TOKYO_NIGHT,
      ui: {
        ...TOKYO_NIGHT.ui,
        dark: {
          ...TOKYO_NIGHT.ui.dark,
          hoverBg: 'rgba(1, 2, 3, 0.5)',
          overlay: 'rgba(4, 5, 6, 0.4)',
          selectionFg: '#abcdef',
          accentFg: '#101010',
          warning: '#111111',
          error: '#222222',
          success: '#333333',
        },
      },
    }
    const vars = themeCssVars(themed, 'dark')
    expect(vars['--theme-hover-bg']).toBe('rgba(1, 2, 3, 0.5)')
    expect(vars['--theme-overlay']).toBe('rgba(4, 5, 6, 0.4)')
    expect(vars['--theme-selection-fg']).toBe('#abcdef')
    expect(vars['--theme-accent-fg']).toBe('#101010')
    expect(vars['--theme-warning']).toBe('#111111')
    expect(vars['--theme-error']).toBe('#222222')
    expect(vars['--theme-success']).toBe('#333333')
  })

  it('still dresses a theme that predates the ui block', () => {
    const vars = themeCssVars(withoutUi(), 'dark')
    expect(vars['--theme-accent']).toBe(TOKYO_NIGHT.terminal.dark.blue)
    expect(vars['--theme-popup-bg']).toBe('#24283b')
    expect(vars['--theme-font-mono']).toBe(DEFAULT_MONO_STACK)
    expect(vars['--theme-card-bg']).toBe(TOKYO_NIGHT.terminal.dark.background)
  })

  it('gives the named legacy themes their own accent and lightens a light legacy theme', () => {
    const homebrew = { ...withoutUi(), id: 'mac-homebrew' }
    expect(themeCssVars(homebrew, 'dark')['--theme-accent']).toBe('#28FE14')

    const novel = { ...withoutUi(), id: 'mac-novel' }
    const vars = themeCssVars(novel, 'light')
    expect(vars['--theme-accent']).toBe('#A05A00')
    expect(vars['--theme-sidebar-bg']).toBe('rgba(0, 0, 0, 0.05)')
    expect(vars['--theme-dim']).toBe('#73635A')

    expect(themeCssVars({ ...withoutUi(), id: 'tokyo-night' }, 'dark')['--theme-accent']).toBe('#7aa2f7')
  })

  it('writes the record onto an element', () => {
    const element = document.createElement('div')
    applyThemeVars(element, { '--theme-bg': '#123456' })
    expect(element.style.getPropertyValue('--theme-bg')).toBe('#123456')
  })
})

describe('isColorLight', () => {
  it.each([
    ['#ffffff', true],
    ['#fff', true],
    ['#000000', false],
    ['#1a1b26', false],
    ['not-a-color', false],
    ['#12', false],
    ['#gggggg', false],
    ['', false],
  ])('classifies %s', (hex, expected) => expect(isColorLight(hex)).toBe(expected))
})

describe('isSquareTheme', () => {
  const withRadii = (dark: string[], light: string[]): AppTheme => ({
    ...TOKYO_NIGHT,
    ui: {
      ...TOKYO_NIGHT.ui,
      dark: { ...TOKYO_NIGHT.ui.dark, borderRadiusSm: dark[0], borderRadiusMd: dark[1], borderRadiusLg: dark[2], borderRadiusXl: dark[3] },
      light: { ...TOKYO_NIGHT.ui.light, borderRadiusSm: light[0], borderRadiusMd: light[1], borderRadiusLg: light[2], borderRadiusXl: light[3] },
    },
  })

  it('is true when every radius is zero in both modes', () => {
    expect(isSquareTheme(withRadii(['0', '0', '0', '0'], ['0px', '0px', '0px', '0px']))).toBe(true)
  })

  it.each([
    [['0.25rem', '0', '0', '0'], ['0', '0', '0', '0']], // one non-zero radius in dark
    [['0', '0', '0', '0'], ['0', '0', '0', '0.5rem']], // one non-zero radius in light
  ])('is false when any radius survives: %o / %o', (dark, light) => {
    expect(isSquareTheme(withRadii(dark, light))).toBe(false)
  })

  it('is false for a theme without a ui block', () => {
    expect(isSquareTheme(withoutUi())).toBe(false)
  })
})

describe('the editable field registry', () => {
  it('covers both halves of the theme and reads their values', () => {
    expect(APP_COLOR_FIELDS.some(f => f.source === 'terminal')).toBe(true)
    expect(APP_COLOR_FIELDS.some(f => f.source === 'ui')).toBe(true)
    expect(TERMINAL_COLOR_FIELDS).toHaveLength(18)

    const background = APP_COLOR_FIELDS.find(f => f.key === 'background')!
    expect(readColorField(TOKYO_NIGHT, 'dark', background)).toBe(TOKYO_NIGHT.terminal.dark.background)
    const accent = APP_COLOR_FIELDS.find(f => f.key === 'accent')!
    expect(readColorField(TOKYO_NIGHT, 'light', accent)).toBe(TOKYO_NIGHT.ui.light.accent)
    expect(readColorField(withoutUi(), 'dark', accent)).toBe('')
  })

  it('resolves an unset optional colour to what the app actually paints', () => {
    const overlay = APP_COLOR_FIELDS.find(f => f.key === 'overlay')!
    expect(resolvedColorField(TOKYO_NIGHT, 'dark', overlay)).toBe('rgba(15, 23, 42, 0.58)')

    // `accentFg` defaults to the app background — resolved to the colour itself, not the `var()`
    // reference, because a swatch has to show a colour.
    const accentFg = APP_COLOR_FIELDS.find(f => f.key === 'accentFg')!
    expect(resolvedColorField(TOKYO_NIGHT, 'dark', accentFg)).toBe(TOKYO_NIGHT.terminal.dark.background)

    // The built-in defines its own light-mode ANSI-black background; a theme that does not falls back
    // to that palette's plain black.
    expect(resolvedColorField(TOKYO_NIGHT, 'light', LIGHT_ONLY_TERMINAL_FIELD))
      .toBe(TOKYO_NIGHT.terminal.light.lightModeBlackBackground)
    const noBlackBackground: AppTheme = {
      ...TOKYO_NIGHT,
      terminal: {
        dark: TOKYO_NIGHT.terminal.dark,
        light: { ...TOKYO_NIGHT.terminal.light, lightModeBlackBackground: undefined },
      },
    }
    expect(resolvedColorField(noBlackBackground, 'light', LIGHT_ONLY_TERMINAL_FIELD))
      .toBe(TOKYO_NIGHT.terminal.light.black)

    const unknown = { key: 'nope', source: 'ui', label: 'Nope', hint: '' } as const
    expect(resolvedColorField(TOKYO_NIGHT, 'dark', unknown)).toBe('#000000')
  })
})
