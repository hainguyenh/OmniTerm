import { describe, expect, it } from 'vitest'

import { readPaneScreen, registerPaneScreen } from '../paneScreens'

function fakeTerminal(lines: string[], rows: number, baseY: number) {
  return {
    rows,
    buffer: {
      active: {
        baseY,
        getLine: (index: number) => (index < lines.length ? { translateToString: () => lines[index] } : undefined),
      },
    },
  } as unknown as Parameters<typeof registerPaneScreen>[1]
}

describe('paneScreens', () => {
  it('reads the bottom page of a registered pane, even when it is scrolled up', () => {
    const term = fakeTerminal(['old 1', 'old 2', 'top', 'prompt'], 2, 2)
    const registration = registerPaneScreen('s1', term)
    expect(readPaneScreen('s1')).toEqual(['top', 'prompt'])
    registration.dispose()
    expect(readPaneScreen('s1')).toBeNull()
  })

  it('keeps a remounted pane registered when the old one is disposed', () => {
    const first = registerPaneScreen('s2', fakeTerminal(['a'], 1, 0))
    registerPaneScreen('s2', fakeTerminal(['b', ''], 2, 0))
    first.dispose()
    expect(readPaneScreen('s2')).toEqual(['b', ''])
    expect(readPaneScreen('missing')).toBeNull()
  })

  it('handles lines that are missing or out of buffer range', () => {
    const term = fakeTerminal(['line1'], 3, 0)
    registerPaneScreen('s3', term)
    expect(readPaneScreen('s3')).toEqual(['line1', '', ''])
  })
})
