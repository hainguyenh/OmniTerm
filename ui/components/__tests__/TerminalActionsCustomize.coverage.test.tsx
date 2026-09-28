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
    expect(screen.getByRole('checkbox', { name: 'Theme' })).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'Focus pane full screen' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Detach terminal' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Stop current process' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Clear terminal' })).toBeChecked()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Theme' }))
    expect(props.onChange).toHaveBeenLastCalledWith({
      header: ['detach', 'fullscreen', 'theme'],
      footer: ['clear', 'save'],
    })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Clear terminal' }))
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

  it('renders the bottom placement and handles an empty selection', () => {
    const { props, unmount } = renderCustomize({
      headerActions: [],
      footerActions: [],
      availableHeaderActions: [],
      availableFooterActions: [],
      placement: 'bottom',
    })

    expect(screen.getByRole('dialog')).toHaveClass('top-full')
    expect(screen.getByRole('checkbox', { name: 'Detach terminal' })).not.toBeChecked()
    expect(screen.queryByRole('button', { name: /Move/ })).not.toBeInTheDocument()
    unmount()
    expect(props.onClose).not.toHaveBeenCalled()
  })
})
