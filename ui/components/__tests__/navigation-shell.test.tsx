/**
 * @vitest-environment jsdom
 */
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ActivityBar from '../ActivityBar'
import CloseConfirmModal from '../CloseConfirmModal'
import ConnectingOverlay from '../ConnectingOverlay'
import DetachedPlaceholder from '../DetachedPlaceholder'
import { PaneResizers } from '../PaneResizers'
import WaitingPane from '../WaitingPane'
import type { SplitRatios } from '../../paneLayout'

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

    fireEvent.click(screen.getByTitle('Workspace'))
    expect(onViewChange).toHaveBeenCalledWith(null)
    fireEvent.click(screen.getByTitle('Files'))
    expect(onViewChange).toHaveBeenCalledTimes(1)
    expect(screen.getByTitle('Files')).toBeDisabled()

    rerender(
      <ActivityBar
        activeView={null}
        filesEnabled
        onViewChange={onViewChange}
        onSettingsClick={onSettingsClick}
      />,
    )
    fireEvent.click(screen.getByTitle('Files'))
    expect(onViewChange).toHaveBeenLastCalledWith('files')
    fireEvent.click(screen.getByTitle('Settings'))
    expect(onSettingsClick).toHaveBeenCalledOnce()
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

  it('keeps full waiting-pane controls clickable around scaled idle art', () => {
    const onNewSession = vi.fn()
    const onChooseSession = vi.fn()
    const onPickShell = vi.fn()
    const { container, rerender } = render(
      <WaitingPane
        dark
        onNewSession={onNewSession}
        onPickShell={onPickShell}
      />,
    )
    expect(screen.getByText('Ctrl+N')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New Terminal' }))
    fireEvent.click(screen.getByTitle('Select Shell'))
    expect(onNewSession).toHaveBeenCalledOnce()
    expect(onPickShell).toHaveBeenCalledWith(expect.objectContaining({ width: expect.any(Number) }))
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('idle-art').parentElement).toHaveClass('pointer-events-none')

    rerender(
      <WaitingPane
        dark={false}
        compact
        paneIndex={2}
        customArtUrl="asset://idle.png"
        openSessionCount={3}
        onNewSession={onNewSession}
        onPickShell={onPickShell}
        onChooseSession={onChooseSession}
      />,
    )
    expect(screen.queryByText('Open a terminal')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Terminal workspace' })).toBeInTheDocument()
    expect(screen.queryByText('Ctrl+N')).not.toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', 'asset://idle.png')
    expect(screen.getByTestId('idle-art')).toHaveStyle({ transform: 'scale(2)' })
    expect(screen.getByTestId('idle-art').parentElement).toHaveClass('pointer-events-none')
    fireEvent.click(screen.getByText('New Terminal'))
    fireEvent.click(screen.getByRole('button', { name: 'Choose open session (3)' }))
    fireEvent.click(screen.getByText('Choose open session (3)'))
    expect(onNewSession).toHaveBeenCalledTimes(2)
    expect(onChooseSession).toHaveBeenCalledTimes(2)
  })
})

describe('PaneResizers', () => {
  function Harness({
    mode = 2,
    split3Style = 'left',
    split2Style = 'columns',
    onCommit = vi.fn(),
  }: {
    mode?: 1 | 2 | 3 | 4 | 6 | 8
    split3Style?: 'left' | 'right' | 'top'
    split2Style?: 'columns' | 'rows'
    onCommit?: (ratios: SplitRatios) => void
  }) {
    const [ratios, setRatios] = useState<SplitRatios>({ main: 0.5, cross: 0.5 })
    return (
      <PaneResizers
        mode={mode}
        split3Style={split3Style}
        split2Style={split2Style}
        ratios={ratios}
        onChange={setRatios}
        onCommit={onCommit}
      />
    )
  }

  it('renders no divider for a single pane and all dividers for a grid', () => {
    const { rerender } = render(<Harness mode={1} />)
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    rerender(<Harness mode={4} />)
    expect(screen.getAllByRole('separator')).toHaveLength(2)
  })

  it('drags a vertical divider and commits the latest ratio', () => {
    const onCommit = vi.fn()
    const { container } = render(<Harness onCommit={onCommit} />)
    const area = container.firstElementChild?.parentElement ?? container
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, width: 1000, height: 600,
      right: 1000, bottom: 600, toJSON: () => ({}),
    })
    const divider = screen.getByRole('separator', { name: 'Resize panes' })
    fireEvent.pointerDown(divider, { pointerId: 7, clientX: 500 })
    fireEvent.pointerMove(divider, { pointerId: 7, clientX: 700 })
    fireEvent.pointerUp(divider, { pointerId: 7, clientX: 700 })
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ main: 0.7 }))
  })

  it('drags a grid divider and persists its cumulative boundary', () => {
    const onCommit = vi.fn()
    const { container } = render(<Harness mode={4} onCommit={onCommit} />)
    const area = container.firstElementChild?.parentElement ?? container
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, width: 1000, height: 600,
      right: 1000, bottom: 600, toJSON: () => ({}),
    })
    const divider = screen.getByRole('separator', { name: 'Resize columns' })
    fireEvent.pointerDown(divider, { pointerId: 9, clientX: 500 })
    fireEvent.pointerMove(divider, { pointerId: 9, clientX: 700 })
    fireEvent.pointerUp(divider, { pointerId: 9, clientX: 700 })
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ columns: [0.7] }))
  })

  it('handles horizontal and mirrored three-pane dividers', () => {
    const onCommit = vi.fn()
    const { container, rerender } = render(
      <Harness mode={2} split2Style="rows" onCommit={onCommit} />,
    )
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, width: 800, height: 800,
      right: 800, bottom: 800, toJSON: () => ({}),
    })
    const horizontal = screen.getByRole('separator', { name: 'Resize panes' })
    fireEvent.pointerDown(horizontal, { pointerId: 8, clientY: 400 })
    fireEvent.pointerCancel(horizontal, { pointerId: 8, clientY: 600 })
    expect(onCommit).toHaveBeenCalled()

    rerender(<Harness mode={3} split3Style="right" onCommit={onCommit} />)
    expect(screen.getAllByRole('separator')).toHaveLength(2)
  })
})
