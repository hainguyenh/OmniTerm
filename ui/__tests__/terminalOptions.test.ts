import { describe, expect, it } from 'vitest'
import { TOKYO_NIGHT } from '../themes'
import { createTerminalOptions, DEFAULT_MONO_STACK, resolveTerminalFontFamily } from '../utils/terminalOptions'

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

describe('resolveTerminalFontFamily', () => {
  it('appends CJK and emoji fallbacks to the default stack', () => {
    const stack = resolveTerminalFontFamily()
    expect(stack.startsWith(DEFAULT_MONO_STACK)).toBe(true)
    expect(stack).toContain('"Microsoft YaHei"')
    expect(stack).toContain('"PingFang SC"')
    expect(stack).toContain('"Noto Sans Mono CJK SC"')
  })

  it('appends fallbacks to a custom stack without duplicating families', () => {
    const stack = resolveTerminalFontFamily('Iosevka, \'microsoft yahei\', monospace')
    expect(stack.startsWith('Iosevka, \'microsoft yahei\', monospace')).toBe(true)
    expect(stack.toLowerCase().match(/microsoft yahei/g)).toHaveLength(1)
  })

  it('is what the terminal is constructed with', () => {
    const options = createTerminalOptions({ isLocal: false, theme: TOKYO_NIGHT.terminal.dark })
    expect(options.fontFamily).toBe(resolveTerminalFontFamily())
  })
})
