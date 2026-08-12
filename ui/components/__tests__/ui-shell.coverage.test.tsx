/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ActivityBar from '../ActivityBar'
import CloseConfirmModal from '../CloseConfirmModal'
import ConnectingOverlay from '../ConnectingOverlay'
import DetachedPlaceholder from '../DetachedPlaceholder'
import { PaneResizers } from '../PaneResizers'
import WaitingPane from '../WaitingPane'

vi.mock('../../assets/defaultArt', () => ({
  DefaultLoadingArt: ({ dark }: any) => <div data-testid="loading-art-content">{String(dark)}</div>,
  DefaultIdleArt: ({ dark }: any) => <div data-testid="idle-art-content">{String(dark)}</div>,
}))

describe('small UI shells', () => {
  it('switches, collapses, disables, and opens settings from the activity bar', () => {
    const onViewChange = vi.fn()
    const onSettingsClick = vi.fn()
    const { rerender } = render(<ActivityBar activeView="workspace" filesEnabled={false} onViewChange={onViewChange} onSettingsClick={onSettingsClick} />)
    fireEvent.click(screen.getByTitle('Workspace'))
    expect(onViewChange).toHaveBeenCalledWith(null)
    fireEvent.click(screen.getByTitle('Files'))
    expect(onViewChange).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTitle('Settings'))
    expect(onSettingsClick).toHaveBeenCalled()
    rerender(<ActivityBar activeView={null} filesEnabled onViewChange={onViewChange} onSettingsClick={onSettingsClick} />)
    fireEvent.click(screen.getByTitle('Files'))
    expect(onViewChange).toHaveBeenLastCalledWith('files')
  })

  it('hides Always Awake unless the plugin providing it is loaded', () => {
    const { rerender } = render(
      <ActivityBar activeView={null} filesEnabled onViewChange={vi.fn()} onSettingsClick={vi.fn()} alwaysAwakeEnabled />,
    )
    expect(screen.queryByTitle(/Always Awake/)).not.toBeInTheDocument()

    rerender(
      <ActivityBar activeView={null} filesEnabled onViewChange={vi.fn()} onSettingsClick={vi.fn()} alwaysAwakeAvailable />,
    )
    expect(screen.getByTitle('Always Awake')).toBeInTheDocument()
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
    const awake = screen.getByTitle('Always Awake (active)')
    const settings = screen.getByTitle('Settings')
    // Same pinned group as Settings, and immediately above it.
    expect(awake.parentElement).toBe(settings.parentElement)
    expect(awake.nextElementSibling).toBe(settings)
    expect(screen.getByTitle('Files').parentElement).not.toBe(settings.parentElement)

    fireEvent.click(awake)
    expect(onAlwaysAwakeClick).toHaveBeenCalled()
  })

  it('pins Blur above Always Awake and reports its enabled state', () => {
    const onBlurClick = vi.fn()
    render(
      <ActivityBar
        activeView={null}
        filesEnabled
        onViewChange={vi.fn()}
        onSettingsClick={vi.fn()}
        blurAvailable
        blurEnabled
        onBlurClick={onBlurClick}
        alwaysAwakeAvailable
      />,
    )
    const blur = screen.getByTitle('Blur inactive windows (on)')
    const awake = screen.getByTitle('Always Awake')
    expect(blur.nextElementSibling).toBe(awake)
    fireEvent.click(blur)
    expect(onBlurClick).toHaveBeenCalled()
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

  it('drives detached placeholder and waiting-pane controls in compact and full layouts', () => {
    const focus = vi.fn(), attach = vi.fn(), open = vi.fn(), pick = vi.fn(), choose = vi.fn()
    const { rerender } = render(<DetachedPlaceholder name="Long session" onFocus={focus} onReattach={attach} compact />)
    fireEvent.click(screen.getByText('Focus window'))
    fireEvent.click(screen.getByText('Attach back into this tab'))
    expect(focus).toHaveBeenCalled()
    expect(attach).toHaveBeenCalled()

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 2, bottom: 9 } as DOMRect)
    rerender(<WaitingPane dark compact paneIndex={1} openSessionCount={3} onNewSession={open} onPickShell={pick} onChooseSession={choose} />)
    expect(screen.getByRole('button', { name: 'Terminal workspace' })).toBeInTheDocument()
    expect(screen.queryByText('Open a terminal')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('New Terminal'))
    fireEvent.click(screen.getByTitle('Select Shell'))
    fireEvent.click(screen.getByText('Choose open session (3)'))
    expect(open).toHaveBeenCalled()
    expect(pick).toHaveBeenCalledWith(expect.objectContaining({ left: 2, bottom: 9 }))
    expect(choose).toHaveBeenCalled()
    expect(screen.getByTestId('idle-art')).toHaveTextContent('true')
    expect(screen.getByTestId('idle-art')).toHaveStyle({ transform: 'scale(2)' })

    rerender(<WaitingPane dark={false} onNewSession={open} onPickShell={pick} customArtUrl="blob:idle" />)
    expect(screen.getByRole('img', { name: 'waiting' })).toHaveAttribute('src', 'blob:idle')
    expect(screen.getByText(/Ctrl\+N/)).toBeInTheDocument()
  })

  it('resizes horizontal, vertical, mirrored, and stacked pane dividers', () => {
    const onChange = vi.fn()
    const onCommit = vi.fn()
    const ratios = { main: .5, cross: .5 }
    const { rerender, container } = render(<div><PaneResizers mode={2} split2Style="columns" split3Style="left" ratios={ratios} onChange={onChange} onCommit={onCommit} /></div>)
    vi.spyOn(container.firstElementChild as HTMLElement, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 800 } as DOMRect)
    let separator = screen.getByRole('separator') as HTMLElement
    separator.setPointerCapture = vi.fn()
    fireEvent.pointerDown(separator, { pointerId: 1 })
    fireEvent.pointerMove(separator, { clientX: 700 })
    fireEvent.pointerUp(separator)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ main: .7 }))
    expect(onCommit).toHaveBeenCalledWith(ratios)

    rerender(<div><PaneResizers mode={2} split2Style="rows" split3Style="left" ratios={ratios} onChange={onChange} onCommit={onCommit} /></div>)
    separator = screen.getByRole('separator') as HTMLElement
    separator.setPointerCapture = vi.fn()
    fireEvent.pointerDown(separator, { pointerId: 2 })
    fireEvent.pointerMove(separator, { clientY: 600 })
    fireEvent.pointerCancel(separator)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ main: .75 }))

    rerender(<div><PaneResizers mode={3} split2Style="columns" split3Style="right" ratios={ratios} onChange={onChange} onCommit={onCommit} /></div>)
    const separators = screen.getAllByRole('separator') as HTMLElement[]
    for (const item of separators) item.setPointerCapture = vi.fn()
    fireEvent.pointerDown(separators[0], { pointerId: 3 })
    fireEvent.pointerMove(separators[0], { clientX: 200 })
    fireEvent.pointerUp(separators[0])
    fireEvent.pointerDown(separators[1], { pointerId: 4 })
    fireEvent.pointerMove(separators[1], { clientY: 400 })
    fireEvent.pointerUp(separators[1])
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ main: .8 }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cross: .5 }))

    rerender(<div><PaneResizers mode={1} split2Style="columns" split3Style="left" ratios={ratios} onChange={onChange} onCommit={onCommit} /></div>)
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })
})
