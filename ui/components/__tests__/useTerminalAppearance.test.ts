/** @vitest-environment jsdom */
import { renderHook } from '@testing-library/react'
import type { Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'

import { COLOR_SCHEMES } from '../../terminal/colorSchemes'
import { TOKYO_NIGHT } from '../../themes'
import { useTerminalAppearance, type PaneAppearance } from '../useTerminalAppearance'

const fakeTerminal = () => ({ options: {} as Record<string, unknown> })

describe('useTerminalAppearance', () => {
  it('applies the palette, contrast and bold settings to the live terminal', () => {
    const term = fakeTerminal()
    const termRef = { current: term as unknown as Terminal }
    const refitRef = { current: () => {} }
    const initialProps: PaneAppearance = { theme: TOKYO_NIGHT.terminal.dark, darkMode: true }
    const { rerender } = renderHook((props: PaneAppearance) => useTerminalAppearance(termRef, refitRef, props), {
      initialProps,
    })
    expect(term.options.minimumContrastRatio).toBe(1)
    expect(term.options.drawBoldTextInBrightColors).toBe(true)

    const dracula = COLOR_SCHEMES.find(s => s.id === 'dracula')!.colors
    rerender({
      theme: dracula,
      darkMode: true,
      look: { lightPalette: false, minimumContrastRatio: 4.5, boldBright: false },
    })
    expect(term.options.minimumContrastRatio).toBe(4.5)
    expect(term.options.drawBoldTextInBrightColors).toBe(false)
    expect((term.options.theme as { background: string }).background).toBe(dracula.background)
  })

  it('does nothing before the terminal exists', () => {
    const termRef = { current: null }
    expect(() => renderHook(() => useTerminalAppearance(termRef, { current: () => {} }, { darkMode: false }))).not.toThrow()
  })
})
