import { describe, expect, it } from 'vitest'

import { COLOR_SCHEMES, FOLLOW_THEME } from '../../../terminal/colorSchemes'
import { DEFAULT_TERMINAL_LOOK } from '../../../terminal/terminalLook'
import { contrastOptions, schemeOptions } from '../terminalAppearanceOptions'

describe('schemeOptions', () => {
  it('lists following the theme, then the presets, then imported schemes', () => {
    const look = {
      ...DEFAULT_TERMINAL_LOOK,
      customSchemes: [{ id: 'custom:mine', name: 'Mine', colors: COLOR_SCHEMES[0]!.colors }],
    }
    const options = schemeOptions(look)
    expect(options[0]?.value).toBe(FOLLOW_THEME)
    expect(options.slice(1, -1).map(o => o.value)).toEqual(COLOR_SCHEMES.map(s => s.id))
    expect(options.at(-1)).toEqual({ value: 'custom:mine', label: 'Mine (imported)' })
  })
})

describe('contrastOptions', () => {
  it('offers the standard ratios and lists a hand-edited one too', () => {
    expect(contrastOptions(DEFAULT_TERMINAL_LOOK).map(o => o.value)).toEqual(['auto', '1', '2', '3', '4.5', '7'])
    expect(contrastOptions({ ...DEFAULT_TERMINAL_LOOK, minContrast: 5.5 }).at(-1)).toEqual({ value: '5.5', label: 'Custom (5.5)' })
  })
})
