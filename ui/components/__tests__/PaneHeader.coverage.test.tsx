/**
 * @vitest-environment jsdom
 */
import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  it('contains no native title attributes in pane chrome', () => {
    const { container } = setup({ conn: { ...ssh, type: 'LOCAL' }, onOpenCurrentDirectory: vi.fn() })
    expect(container.querySelector('[data-pane-header][title]')).toBeNull()
    expect(container.querySelector('[data-pane-header] [title]')).toBeNull()
  })

  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, 'omnitermAPI', {
      configurable: true,
      value: {
        connect: {
          localInput: vi.fn(),
          sshInput: vi.fn(),
          interruptSession: vi.fn().mockResolvedValue(undefined),
        },
      },
    })
  })
  it('focuses, drags connected panes, opens picker, clears, and assigns sessions', () => {
    const x = setup()
    const header = screen.getByText('2').closest('[draggable]') as HTMLElement
    const transfer = { setData: vi.fn(), effectAllowed: '' }
    fireEvent.mouseDown(header)
    fireEvent.dragStart(header, { dataTransfer: transfer })
    fireEvent.dragEnd(header)
    expect(x.props.onFocus).toHaveBeenCalled()
    expect(transfer.setData).toHaveBeenCalledWith('text/plain', '1')
    expect(transfer.effectAllowed).toBe('move')
    expect(x.props.onDragStart).toHaveBeenCalled()
    expect(x.props.onDragEnd).toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Choose session for this pane'))
    expect(x.props.onTogglePicker).toHaveBeenCalledWith(expect.anything())
    fireEvent.click(screen.getByText('Empty this pane'))
    expect(x.props.onClear).toHaveBeenCalled()
    fireEvent.click(screen.getByText('Desktop'))
    expect(x.props.onAssign).toHaveBeenCalledWith('s2')
    expect(screen.getByLabelText(/Shown in pane 1/)).toBeInTheDocument()
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
    const header = screen.getByText('2').closest('[draggable]') as HTMLElement
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



  it('renders the oscillating running indicator while busy', () => {
    const { container } = setup({ busy: true })
    expect(container.querySelector('.animate-running-dot-oscillate')).toBeInTheDocument()
    expect(container.querySelector('.running-dot-ghost-1')).toBeInTheDocument()
    expect(container.querySelector('.running-dot-ghost-2')).toBeInTheDocument()

    expect(container.querySelector('.animate-ping')).toBeNull()
  })

  it('shows a busy agent pane as running, never as Idle, with no loading artwork (regression)', () => {
    const { container } = setup({
      conn: { ...ssh, type: 'LOCAL', shell: 'powershell' },
      sessionTitle: 'Claude Code - OmniTerm',
      busy: true,
    })
    expect(container.querySelector('.animate-running-dot-oscillate')).toBeInTheDocument()
    expect(screen.queryByLabelText('Idle')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('leaves stop/clear/copy/save to the footer in every layout', () => {
    const { rerender, props } = setup({ conn: { ...ssh, type: 'LOCAL' }, sessionId: 's1', busy: true, layoutMode: 3 })
    expect(screen.queryByRole('button', { name: 'Stop current process' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear terminal' })).not.toBeInTheDocument()

    rerender(<PaneHeader {...props} layoutMode={2} />)
    expect(screen.queryByRole('button', { name: 'Stop current process' })).not.toBeInTheDocument()
  })

  it('uses the agent icon and leaves the shell label for the footer', () => {
    setup({
      conn: { ...ssh, type: 'LOCAL', shell: 'powershell' },
      sessionTitle: 'Claude Code - OmniTerm',
      shellLabel: 'PowerShell 7',
    })
    expect(screen.getByRole('img', { name: 'Claude Code' })).toBeInTheDocument()
    expect(screen.getByText('OmniTerm')).toBeInTheDocument()
    expect(screen.queryByText('// PowerShell 7')).toBeNull()
    expect(screen.queryByText('Claude Code')).toBeNull()
  })

  it('keeps the pane header clear of terminal output controls when layoutMode >= 4', () => {
    setup({ conn: { ...ssh, type: 'LOCAL' }, sessionId: 's1', busy: false, layoutMode: 4 })
    expect(screen.queryByRole('button', { name: 'Clear terminal' })).not.toBeInTheDocument()
  })

  it('opens a new local pane at the current directory from the header overflow menu', () => {
    const onOpenCurrentDirectory = vi.fn()
    setup({ conn: { ...ssh, type: 'LOCAL' }, sessionId: 's1', onOpenCurrentDirectory })
    fireEvent.click(screen.getByRole('button', { name: 'More terminal actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open new pane with current directory' }))
    expect(onOpenCurrentDirectory).toHaveBeenCalledOnce()
  })

  it('omits Stop and Clear for RDP panes, which have no PTY semantics', () => {
    setup({ conn: rdp, sessionId: 's2', panes: [null, 's2'], layoutMode: 2, statuses: {} })
    expect(screen.queryByRole('button', { name: 'Stop current process' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear terminal' })).not.toBeInTheDocument()
  })
})
