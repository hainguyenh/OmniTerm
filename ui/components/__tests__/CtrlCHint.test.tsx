/**
 * @vitest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CtrlCHint from '../CtrlCHint'

describe('CtrlCHint', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('renders nothing until triggered', () => {
    render(<CtrlCHint trigger={0} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows the hint on a trigger and hides it after a moment', () => {
    const { rerender } = render(<CtrlCHint trigger={0} />)
    rerender(<CtrlCHint trigger={1} />)
    expect(screen.getByRole('status').textContent).toContain('Ctrl+C again')
    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('restarts the timer on a repeated trigger', () => {
    const { rerender } = render(<CtrlCHint trigger={1} />)
    act(() => { vi.advanceTimersByTime(1000) })
    rerender(<CtrlCHint trigger={2} />)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('status')).toBeTruthy()
  })
})
