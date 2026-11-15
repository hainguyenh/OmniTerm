/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TitleControls } from '../TitleControls'

const base = {
  appSettings: { darkMode: true, themeId: 'x', fontSize: 14 } as AppSettings,
  setAppSettings: vi.fn(),
  themes: [{ id: 'x', name: 'Theme X' }] as never[],
  setThemeRemixOpen: vi.fn(),
}

describe('TitleControls in the workbench title bar (compact)', () => {
  it('has no theme list and no light/dark toggle, only the terminal font size', () => {
    const onApplyToAll = vi.fn()
    render(<TitleControls {...base} zoomFactor={1} onApplyToAll={onApplyToAll} compact />)
    expect(screen.queryByRole('button', { name: /Switch to (Light|Dark) Mode/ })).toBeNull()
    expect(screen.queryByText('Theme X')).toBeNull()
    expect(screen.queryByText(/^100%$/)).toBeNull()
    fireEvent.click(screen.getByText('+'))
    expect(onApplyToAll).toHaveBeenCalledWith(15)
  })

  it('shows the zoom chip only while the zoom is not 100%', () => {
    const reset = vi.fn()
    render(<TitleControls {...base} zoomFactor={1.25} onZoomReset={reset} compact />)
    fireEvent.click(screen.getByText('125%'))
    expect(reset).toHaveBeenCalled()
  })

  it('keeps the full controls outside the workbench', () => {
    render(<TitleControls {...base} zoomFactor={1} />)
    expect(screen.getByRole('button', { name: 'Switch to Light Mode' })).toBeTruthy()
    expect(screen.getByText('100%')).toBeTruthy()
  })
})
