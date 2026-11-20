/**
 * @vitest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { PANE_IDENTITY } from '../../paneIdentity'
import { SessionColorMark } from '../sessions/SessionColorMark'
import { cycleSessionColor, nextFreeIndex, parseStoredColors, syncSessionColors, useSessionColors } from '../sessions/sessionColors'

beforeEach(() => {
  useSessionColors.setState({ byId: {} })
})

describe('session colours', () => {
  it('gives each live session its own colour and forgets ended ones', () => {
    syncSessionColors(['a', 'b', 'c'])
    const { byId } = useSessionColors.getState()
    expect(new Set(Object.values(byId)).size).toBe(3)
    syncSessionColors(['a', 'c'])
    expect(Object.keys(useSessionColors.getState().byId)).toEqual(['a', 'c'])
    expect(useSessionColors.getState().byId.a).toBe(byId.a)
  })

  it('reuses the least used colour once the palette is full', () => {
    expect(nextFreeIndex(PANE_IDENTITY.map((_, i) => i))).toBe(0)
    expect(nextFreeIndex([0, 0, 1])).toBe(2)
  })

  it('shows one session in the same colour everywhere, and a change reaches every mark', () => {
    syncSessionColors(['a', 'b'])
    render(<><SessionColorMark sessionId="a" /><SessionColorMark sessionId="a" /></>)
    const marks = screen.getAllByRole('button')
    expect(marks[0]!.getAttribute('data-session-color')).toBe(marks[1]!.getAttribute('data-session-color'))
    const before = marks[0]!.getAttribute('data-session-color')
    act(() => { marks[0]!.click() })
    const after = screen.getAllByRole('button').map((mark) => mark.getAttribute('data-session-color'))
    expect(after[0]).not.toBe(before)
    expect(after[0]).toBe(after[1])
  })

  it('draws nothing for a session without a colour', () => {
    const { container } = render(<SessionColorMark sessionId="unknown" />)
    expect(container.firstChild).toBeNull()
  })

  it('cycles through the palette and wraps', () => {
    syncSessionColors(['a'])
    const start = useSessionColors.getState().byId.a!
    for (let i = 0; i < PANE_IDENTITY.length; i++) cycleSessionColor('a')
    expect(useSessionColors.getState().byId.a).toBe(start)
  })

  it('drops invalid persisted entries', () => {
    expect(parseStoredColors({ a: 1, b: 99, c: 'x', d: 1.5, '': 2 })).toEqual({ a: 1 })
    expect(parseStoredColors([1, 2])).toEqual({})
    expect(parseStoredColors(null)).toEqual({})
  })
})
