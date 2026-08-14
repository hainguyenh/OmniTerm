/**
 * @vitest-environment jsdom
 */
import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import PaneHeader from '../PaneHeader'

const ssh: Connection = { id: 'ssh', name: 'SSH Server', type: 'SSH', host: 'host', port: '22', user: 'me' }
const rdp: Connection = { id: 'rdp', name: 'Desktop', type: 'RDP', host: 'desk', port: '3389', user: 'me' }
const tabs = [
  { id: 's1', connId: 'ssh', name: 'SSH Server' },
  { id: 's2', connId: 'rdp', name: 'Desktop' },
]

function setup(overrides: Partial<React.ComponentProps<typeof PaneHeader>> = {}) {
  const props: React.ComponentProps<typeof PaneHeader> = {
    paneIndex: 1, conn: ssh, focused: false, sessionId: 's1', tabs, panes: ['s2', 's1', null],
    layoutMode: 3, statuses: { s1: 'connected', s2: 'error' }, connType: id => id === 'rdp' ? 'RDP' : 'SSH',
    pickerOpen: true, pickerRef: createRef<HTMLDivElement>(), detach: null, onToggleDetach: vi.fn(),
    onFocus: vi.fn(), onDragStart: vi.fn(), onDragEnd: vi.fn(), onTogglePicker: vi.fn(),
    onAssign: vi.fn(), onClear: vi.fn(), ...overrides,
  }
  return { ...render(<PaneHeader {...props} />), props }
}

describe('PaneHeader remaining behavior', () => {
  it('focuses, drags connected panes, opens picker, clears, and assigns sessions', () => {
    const x = setup()
    const header = screen.getByTitle(/Pane 2/)
    const transfer = { setData: vi.fn(), effectAllowed: '' }
    fireEvent.mouseDown(header)
    fireEvent.dragStart(header, { dataTransfer: transfer })
    fireEvent.dragEnd(header)
    expect(x.props.onFocus).toHaveBeenCalled()
    expect(transfer.setData).toHaveBeenCalledWith('text/plain', '1')
    expect(transfer.effectAllowed).toBe('move')
    expect(x.props.onDragStart).toHaveBeenCalled()
    expect(x.props.onDragEnd).toHaveBeenCalled()

    fireEvent.click(screen.getByTitle('Choose session for this pane'))
    expect(x.props.onTogglePicker).toHaveBeenCalledWith(expect.anything())
    fireEvent.click(screen.getByText('Empty this pane'))
    expect(x.props.onClear).toHaveBeenCalled()
    fireEvent.click(screen.getByText('Desktop'))
    expect(x.props.onAssign).toHaveBeenCalledWith('s2')
    expect(screen.getByTitle(/Shown in pane 1/)).toBeInTheDocument()
  })

  it('renders RDP identity, default connecting status, current check, and focused styling', () => {
    setup({ conn: rdp, focused: true, sessionId: 's2', panes: [null, 's2'], layoutMode: 2, statuses: {} })
    expect(screen.getAllByText('Desktop')).toHaveLength(2)
    expect(screen.getByText('Empty this pane')).toBeInTheDocument()
    expect(document.querySelector('.bg-theme-bg')).toBeInTheDocument()
    expect(document.querySelector('.bg-theme-warning')).toBeInTheDocument()
  })

  it('renders an inert empty pane and its empty picker state', () => {
    const x = setup({ conn: null, sessionId: null, tabs: [], panes: [null, null], pickerOpen: true })
    const header = screen.getByTitle(/Pane 2/)
    expect(screen.getByText('Empty pane')).toBeInTheDocument()
    expect(screen.getByText('No open sessions')).toBeInTheDocument()
    expect(screen.queryByText('Empty this pane')).not.toBeInTheDocument()
    fireEvent.dragStart(header)
    expect(x.props.onDragStart).not.toHaveBeenCalled()
  })

  it('toggles pane focus mode from the pane chrome', () => {
    const onToggleFullscreen = vi.fn()
    const x = setup({ fullscreen: false, onToggleFullscreen })
    fireEvent.click(screen.getByRole('button', { name: 'Focus pane full screen' }))
    expect(onToggleFullscreen).toHaveBeenCalled()
    x.rerender(<PaneHeader {...x.props} fullscreen />)
    expect(screen.getByRole('button', { name: 'Restore view mode' })).toBeInTheDocument()
  })
})
