/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ActivityBar from '../ActivityBar'
import CloseConfirmModal from '../CloseConfirmModal'
import ConnectingOverlay from '../ConnectingOverlay'
import DetachedPlaceholder from '../DetachedPlaceholder'

describe('navigation and empty-session shell', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
  })

  it('switches, collapses, and disables activity views', () => {
    const onViewChange = vi.fn()
    const onSettingsClick = vi.fn()
    const { rerender } = render(
      <ActivityBar
        activeView="workspace"
        filesEnabled={false}
        onViewChange={onViewChange}
        onSettingsClick={onSettingsClick}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    expect(onViewChange).toHaveBeenCalledWith(null)
    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    expect(onViewChange).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Files' })).toBeDisabled()

    rerender(
      <ActivityBar
        activeView={null}
        filesEnabled
        onViewChange={onViewChange}
        onSettingsClick={onSettingsClick}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    expect(onViewChange).toHaveBeenLastCalledWith('files')
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onSettingsClick).toHaveBeenCalledOnce()
  })

  it('hides Git activity icon when gitEnabled is false and shows when true', () => {
    const onViewChange = vi.fn()
    const { rerender } = render(
      <ActivityBar
        activeView={null}
        filesEnabled
        gitEnabled={false}
        onViewChange={onViewChange}
        onSettingsClick={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Git' })).not.toBeInTheDocument()

    rerender(
      <ActivityBar
        activeView={null}
        filesEnabled
        gitEnabled={true}
        onViewChange={onViewChange}
        onSettingsClick={vi.fn()}
      />,
    )
    const gitBtn = screen.getByRole('button', { name: 'Git' })
    expect(gitBtn).toBeInTheDocument()
    const opened = vi.fn()
    window.addEventListener('omniterm:open-git', opened)
    fireEvent.click(gitBtn)
    window.removeEventListener('omniterm:open-git', opened)
    // The Git button opens the workbench Git window; it is not a side panel view any more.
    expect(opened).toHaveBeenCalledTimes(1)
    expect(onViewChange).not.toHaveBeenCalled()
  })

  it('confirms one or many connected terminal closes and supports every cancel route', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { container, rerender } = render(
      <CloseConfirmModal onConfirm={onConfirm} onCancel={onCancel} isMultiple={false} />,
    )
    expect(screen.getByText('Close Terminal')).toHaveClass('text-[var(--theme-selection-fg)]')
    expect(screen.getByText('Close Terminal')).not.toHaveClass('text-white')
    expect(screen.getByText(/This terminal session is currently connected/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Close Anyway' }))
    expect(onConfirm).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(container.firstElementChild as Element)
    expect(onCancel).toHaveBeenCalledTimes(3)

    rerender(<CloseConfirmModal onConfirm={onConfirm} onCancel={onCancel} isMultiple />)
    expect(screen.getByText(/multiple connected terminal sessions/)).toBeInTheDocument()
    const card = screen.getByText('Close Terminal').closest('div')
    fireEvent.click(card as Element)
    expect(onCancel).toHaveBeenCalledTimes(3)
  })

  it('renders built-in or custom connecting art', () => {
    const { container, rerender } = render(<ConnectingOverlay dark label="Opening SSH…" />)
    expect(screen.getByText('Opening SSH…')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('loading-art')).toHaveStyle({ transform: 'scale(2)' })

    rerender(<ConnectingOverlay dark={false} customArtUrl="asset://loading.png" />)
    expect(screen.getByText('Connecting…')).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', 'asset://loading.png')
    expect(screen.getByTestId('loading-art')).toHaveStyle({ transform: 'scale(2)' })
  })

  it('focuses or reattaches a detached session in normal and compact layouts', () => {
    const onFocus = vi.fn()
    const onReattach = vi.fn()
    const { rerender } = render(
      <DetachedPlaceholder name="Production SSH" onFocus={onFocus} onReattach={onReattach} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Focus window' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attach back into this tab' }))
    expect(onFocus).toHaveBeenCalledOnce()
    expect(onReattach).toHaveBeenCalledOnce()

    rerender(
      <DetachedPlaceholder compact name="Production SSH" onFocus={onFocus} onReattach={onReattach} />,
    )
    expect(screen.getByText('Production SSH')).toBeInTheDocument()
  })

})

