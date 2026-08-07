import { describe, expect, it } from 'vitest'
import { TOKYO_NIGHT } from '../themes'
import { createTerminalOptions } from '../utils/terminalOptions'

describe('createTerminalOptions', () => {
  it('enables contrast correction only for light mode', () => {
    const dark = createTerminalOptions({
      isLocal: false,
      darkMode: true,
      theme: TOKYO_NIGHT.terminal.dark,
    })
    const light = createTerminalOptions({
      isLocal: false,
      darkMode: false,
      theme: TOKYO_NIGHT.terminal.light,
    })

    expect(dark.minimumContrastRatio).toBe(1)
    expect(light.minimumContrastRatio).toBe(2.5)
  })
})
