/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ThemeChoice } from '../../../ide/platform/themes'

const setThemeMock = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const choices = vi.hoisted(() => [
  { id: 'light', label: 'Light', kind: 'light' },
  { id: 'dark', label: 'Dark', kind: 'dark' },
  { id: 'plugin:omniterm/tn@dark', label: 'Tokyo Night (Dark)', kind: 'dark', origin: 'OmniTerm' },
])
vi.mock('../../../ide/workbench/theme', () => ({
  setTheme: setThemeMock,
  useThemeChoices: () => choices,
}))
vi.mock('../../../platform/theme/unifiedTheme', () => ({
  useUnifiedTheme: (select: (state: { choice: string }) => unknown) => select({ choice: 'dark' }),
}))

import { ThemePickerButton } from '../ThemePickerButton'
import { themePopupEntries } from '../themeEntries'

describe('themePopupEntries', () => {
  it('lists dark themes then light ones, captions each section and checks the current theme', () => {
    const entries = themePopupEntries(choices as ThemeChoice[], 'dark', vi.fn())
    expect(entries.map((e) => e.label)).toEqual(['Dark', 'Tokyo Night (Dark)', 'Light'])
    expect(entries.map((e) => e.header)).toEqual(['Dark themes', undefined, 'Light themes'])
    expect(entries.filter((e) => e.checked).map((e) => e.id)).toEqual(['theme:dark'])
  })

  it('selects the chosen theme', () => {
    const select = vi.fn()
    themePopupEntries(choices as ThemeChoice[], 'dark', select)[2]?.run()
    expect(select).toHaveBeenCalledWith('light')
  })
})

describe('ThemePickerButton', () => {
  it('opens the theme list and switches to the picked theme', () => {
    render(<ThemePickerButton />)
    fireEvent.click(screen.getByTestId('title-theme-picker'))
    fireEvent.click(screen.getByText('Tokyo Night (Dark)'))
    expect(setThemeMock).toHaveBeenCalledWith('plugin:omniterm/tn@dark')
    expect(screen.queryByText('Light themes')).toBeNull()
  })
})
