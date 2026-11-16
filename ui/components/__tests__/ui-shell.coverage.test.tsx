/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ActivityBar from '../ActivityBar'
import CloseConfirmModal from '../CloseConfirmModal'
import ConnectingOverlay from '../ConnectingOverlay'
import DetachedPlaceholder from '../DetachedPlaceholder'

vi.mock('../../assets/defaultArt', () => ({
  DefaultLoadingArt: ({ dark }: any) => <div data-testid="loading-art-content">{String(dark)}</div>,
  DefaultIdleArt: ({ dark }: any) => <div data-testid="idle-art-content">{String(dark)}</div>,
}))

describe('small UI shells', () => {
  it('switches, collapses, disables, and opens settings from the activity bar', () => {
    const onViewChange = vi.fn()
    const onSettingsClick = vi.fn()
    const { rerender } = render(<ActivityBar activeView="workspace" filesEnabled={false} onViewChange={onViewChange} onSettingsClick={onSettingsClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    expect(onViewChange).toHaveBeenCalledWith(null)
    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    expect(onViewChange).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onSettingsClick).toHaveBeenCalled()
    rerender(<ActivityBar activeView={null} filesEnabled onViewChange={onViewChange} onSettingsClick={onSettingsClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    expect(onViewChange).toHaveBeenLastCalledWith('files')
  })

  it('hides Always Awake unless the plugin providing it is loaded', () => {
    const { rerender } = render(
      <ActivityBar activeView={null} filesEnabled onViewChange={vi.fn()} onSettingsClick={vi.fn()} alwaysAwakeEnabled />,
    )
    expect(screen.queryByRole('button', { name: /Always Awake/ })).not.toBeInTheDocument()

    rerender(
      <ActivityBar activeView={null} filesEnabled onViewChange={vi.fn()} onSettingsClick={vi.fn()} alwaysAwakeAvailable />,
    )
    expect(screen.getByRole('button', { name: 'Always Awake' })).toBeInTheDocument()
  })

  it('pins Always Awake beside Settings rather than with the panel views', () => {
    const onAlwaysAwakeClick = vi.fn()
    render(
      <ActivityBar
        activeView={null}
        filesEnabled
        onViewChange={vi.fn()}
        onSettingsClick={vi.fn()}
        alwaysAwakeAvailable
        alwaysAwakeEnabled
        alwaysAwakeKeepingAwake
        onAlwaysAwakeClick={onAlwaysAwakeClick}
      />,
    )
    const awake = screen.getByRole('button', { name: 'Always Awake (active)' })
    const settings = screen.getByRole('button', { name: 'Settings' })
    // Same pinned group as Settings, and immediately above it.
    expect(awake.parentElement).toBe(settings.parentElement)
    expect(awake.nextElementSibling).toBe(settings)
    expect(screen.getByRole('button', { name: 'Files' }).parentElement).not.toBe(settings.parentElement)

    fireEvent.click(awake)
    expect(onAlwaysAwakeClick).toHaveBeenCalled()
  })

  it('confirms and cancels closing from buttons, escape, checkbox, and backdrop', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { container, rerender } = render(<CloseConfirmModal isMultiple={false} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByText(/This terminal session/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('Close Anyway'))
    expect(onConfirm).toHaveBeenCalledWith(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByText('Cancel'))
    fireEvent.click(container.firstElementChild as Element)
    expect(onCancel).toHaveBeenCalledTimes(3)
    rerender(<CloseConfirmModal isMultiple onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByText(/multiple connected/)).toBeInTheDocument()
  })

  it('renders default and custom connecting art', () => {
    const { rerender } = render(<ConnectingOverlay dark label="Starting shell" />)
    expect(screen.getByTestId('loading-art')).toHaveTextContent('true')
    expect(screen.getByText('Starting shell')).toBeInTheDocument()
    rerender(<ConnectingOverlay dark={false} customArtUrl="blob:custom" />)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:custom')
    expect(screen.getByTestId('loading-art')).toHaveStyle({ transform: 'scale(2)' })
    expect(screen.getByText('Connecting…')).toBeInTheDocument()
  })

  it('drives the detached placeholder controls in the compact layout', () => {
    const focus = vi.fn(), attach = vi.fn()
    render(<DetachedPlaceholder name="Long session" onFocus={focus} onReattach={attach} compact />)
    fireEvent.click(screen.getByText('Focus window'))
    fireEvent.click(screen.getByText('Attach back into this tab'))
    expect(focus).toHaveBeenCalled()
    expect(attach).toHaveBeenCalled()
  })
})
