/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TerminalActionsCustomize from '../TerminalActionsCustomize'

const renderCustomize = (overrides: Partial<React.ComponentProps<typeof TerminalActionsCustomize>> = {}) => {
  const props: React.ComponentProps<typeof TerminalActionsCustomize> = {
    headerActions: ['detach', 'fullscreen'],
    footerActions: ['clear', 'save'],
    availableHeaderActions: ['theme', 'detach'],
    availableFooterActions: ['clear', 'save'],
    onChange: vi.fn(),
    onClose: vi.fn(),
    placement: 'top',
    ...overrides,
  }
  return { ...render(<TerminalActionsCustomize {...props} />), props }
}

describe('TerminalActionsCustomize', () => {
  it('renders supported and unavailable actions and updates each surface', () => {
    const { props } = renderCustomize()

    expect(screen.getByRole('dialog')).toHaveClass('bottom-full')
    expect(screen.getByRole('switch', { name: 'Theme' })).toBeEnabled()
    expect(screen.getByRole('switch', { name: 'Focus pane full screen' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Detach terminal' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Stop current process' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Clear terminal' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('switch', { name: 'Theme' }))
    expect(props.onChange).toHaveBeenLastCalledWith({
      header: ['detach', 'fullscreen', 'theme'],
      footer: ['clear', 'save'],
    })

    fireEvent.click(screen.getByRole('switch', { name: 'Clear terminal' }))
    expect(props.onChange).toHaveBeenLastCalledWith({
      header: ['detach', 'fullscreen'],
      footer: ['save'],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Move Detach terminal down' }))
    expect(props.onChange).toHaveBeenLastCalledWith({
      header: ['fullscreen', 'detach'],
      footer: ['clear', 'save'],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Move Focus pane full screen up' }))
    expect(props.onChange).toHaveBeenLastCalledWith({
      header: ['fullscreen', 'detach'],
      footer: ['clear', 'save'],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Move Save output to file up' }))
    expect(props.onChange).toHaveBeenLastCalledWith({
      header: ['detach', 'fullscreen'],
      footer: ['save', 'clear'],
    })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(props.onClose).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(document.body)
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps disabled actions off-limits while enabled switches report their state', () => {
    const { props } = renderCustomize({
      headerActions: ['theme', 'detach', 'fullscreen'],
      footerActions: ['clear', 'copy', 'save'],
      availableHeaderActions: ['theme', 'detach', 'fullscreen'],
      availableFooterActions: ['clear', 'copy', 'save'],
    })
    const actionRow = screen.getByText('Copy terminal output').parentElement
    expect(actionRow).toHaveClass('py-1', 'text-xs', 'min-w-0')
    const copy = screen.getByRole('switch', { name: 'Copy terminal output' })
    expect(copy).toHaveClass('h-3.5', 'w-6', 'rounded-md')
    expect(copy).toHaveAttribute('aria-checked', 'true')
    expect(copy.firstElementChild).toHaveClass('rounded-sm')
    fireEvent.click(copy)
    expect(props.onChange).toHaveBeenLastCalledWith({
      header: ['theme', 'detach', 'fullscreen'],
      footer: ['clear', 'save'],
    })
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('renders the bottom placement and handles an empty selection', () => {
    const { props, unmount } = renderCustomize({
      headerActions: [],
      footerActions: [],
      availableHeaderActions: [],
      availableFooterActions: [],
      placement: 'bottom',
    })

    expect(screen.getByRole('dialog')).toHaveClass('top-full')
    expect(screen.getByRole('switch', { name: 'Detach terminal' })).not.toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('button', { name: /Move/ })).not.toBeInTheDocument()
    unmount()
    expect(props.onClose).not.toHaveBeenCalled()
  })
})
