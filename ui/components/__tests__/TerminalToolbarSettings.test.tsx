/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalToolbarActions } from '../../terminalToolbar'
import TerminalToolbarSettings from '../TerminalToolbarSettings'

describe('TerminalToolbarSettings', () => {
  it('renders selected items in selected order and supports moving them up and down', () => {
    const onChange = vi.fn()
    const value: TerminalToolbarActions = {
      header: ['detach', 'theme', 'fullscreen'],
      footer: ['clear', 'stop'],
    }

    render(<TerminalToolbarSettings value={value} onChange={onChange} />)

    // Check that move up on first selected item is disabled
    const moveDetachUp = screen.getByRole('button', { name: 'Move Detach terminal up' })
    expect(moveDetachUp).toBeDisabled()

    // Move theme up (swap with detach)
    const moveThemeUp = screen.getByRole('button', { name: 'Move Theme up' })
    expect(moveThemeUp).toBeEnabled()
    fireEvent.click(moveThemeUp)

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      header: ['theme', 'detach', 'fullscreen'],
    }))

    // Move clear down (swap with stop)
    const moveClearDown = screen.getByRole('button', { name: 'Move Clear terminal down' })
    expect(moveClearDown).toBeEnabled()
    fireEvent.click(moveClearDown)

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      footer: ['stop', 'clear'],
    }))
  })
})
