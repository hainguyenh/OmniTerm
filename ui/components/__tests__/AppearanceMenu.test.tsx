/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AppearanceMenu from '../AppearanceMenu'
import { TOKYO_NIGHT, type AppTheme } from '../../themes'

const OTHER: AppTheme = { ...TOKYO_NIGHT, id: 'other', name: 'Other Theme' }

function renderMenu(props: Partial<React.ComponentProps<typeof AppearanceMenu>> = {}) {
  const onThemeApply = vi.fn()
  const onFontSizeChange = vi.fn()
  render(
    <AppearanceMenu
      themes={[TOKYO_NIGHT, OTHER]}
      themeId={TOKYO_NIGHT.id}
      fontSize={14}
      darkMode
      scopeLabel="active terminal"
      onThemeApply={onThemeApply}
      onFontSizeChange={onFontSizeChange}
      {...props}
    />,
  )
  return { onThemeApply, onFontSizeChange }
}

describe('AppearanceMenu', () => {
  it('shows the current font size and shifts it by one step per click', () => {
    const { onFontSizeChange } = renderMenu()
    fireEvent.click(screen.getByRole('button', { name: '+' }))
    fireEvent.click(screen.getByRole('button', { name: '-' }))
    expect(onFontSizeChange).toHaveBeenNthCalledWith(1, 1)
    expect(onFontSizeChange).toHaveBeenNthCalledWith(2, -1)
    expect(screen.getByText('14')).toBeInTheDocument()
  })

  it('opens the theme list and applies the chosen theme, then closes', () => {
    const { onThemeApply } = renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Appearance — theme & font size' }))
    expect(screen.getByText('Other Theme')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Other Theme'))
    expect(onThemeApply).toHaveBeenCalledWith('other')
    expect(screen.queryByText('Other Theme')).not.toBeInTheDocument()
  })

  it('shows the scope label so it is clear whose look is being changed', () => {
    renderMenu({ scopeLabel: 'Pane 2' })
    fireEvent.click(screen.getByRole('button', { name: 'Appearance — theme & font size' }))
    expect(screen.getByText('Pane 2')).toBeInTheDocument()
  })

  it('offers "Apply to all terminals" and remix only when given a handler for them', () => {
    const onApplyToAll = vi.fn()
    const onRemix = vi.fn()
    renderMenu({ onApplyToAll, onRemix })
    fireEvent.click(screen.getByRole('button', { name: 'Appearance — theme & font size' }))
    fireEvent.click(screen.getByText('Apply to all terminals'))
    expect(onApplyToAll).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Appearance — theme & font size' }))
    fireEvent.click(screen.getByText('Theme Remix…'))
    expect(onRemix).toHaveBeenCalledTimes(1)
  })

  it('omits "Apply to all terminals" and remix when no handler is given', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Appearance — theme & font size' }))
    expect(screen.queryByText('Apply to all terminals')).not.toBeInTheDocument()
    expect(screen.queryByText('Theme Remix…')).not.toBeInTheDocument()
  })

  it('closes on Escape and on an outside click', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Appearance — theme & font size' }))
    expect(screen.getByText('Theme')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('Theme')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Appearance — theme & font size' }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('Theme')).not.toBeInTheDocument()
  })

  it('opens downward with a full list when there is room below the trigger', () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Appearance — theme & font size' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(100, 40, 24, 24),
    )
    fireEvent.click(trigger)
    const list = screen.getByText('Other Theme').closest('.overflow-y-auto') as HTMLElement
    expect(list.style.maxHeight).toBe('240px')
    expect(list.closest('[class*="absolute"]')?.className).toContain('top-full')
  })

  it('flips above the trigger when the popup would run past the bottom of the viewport', () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Appearance — theme & font size' })
    // A header docked near the window's bottom edge: only ~60px below, plenty above.
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(100, 700, 24, 24),
    )
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
    fireEvent.click(trigger)
    const popup = screen.getByText('Other Theme').closest('[class*="absolute"]') as HTMLElement
    expect(popup.className).toContain('bottom-full')
    expect(popup.className).not.toContain('top-full')
    const list = screen.getByText('Other Theme').closest('.overflow-y-auto') as HTMLElement
    // The chosen side has room, so the list keeps its full height — just rendered upward.
    expect(list.style.maxHeight).toBe('240px')
  })
})
