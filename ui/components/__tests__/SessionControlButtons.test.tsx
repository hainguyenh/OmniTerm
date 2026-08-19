/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import { mockOmnitermAPI } from '../../testUtils'
import SessionControlButtons from '../SessionControlButtons'

const local: Connection = {
  id: 'local', name: 'Local', type: 'LOCAL', host: '', port: '', user: '',
}
const ssh: Connection = {
  id: 'ssh', name: 'SSH', type: 'SSH', host: 'host', port: '22', user: 'me',
}
const rdp: Connection = {
  id: 'rdp', name: 'RDP', type: 'RDP', host: 'desk', port: '3389', user: 'me',
}

beforeEach(() => {
  localStorage.clear()
  mockOmnitermAPI({
    connect: {
      localInput: vi.fn(),
      sshInput: vi.fn(),
      setPersistencePolicy: vi.fn().mockResolvedValue(undefined),
    },
  })
})

describe('SessionControlButtons', () => {
  it('renders Stop, Clear, Persistence, Detach, and Fullscreen for a local session', () => {
    render(
      <SessionControlButtons
        conn={local}
        sessionId="s1"
        busy
        isAgent
        detach="detach"
        onToggleDetach={vi.fn()}
        fullscreen={false}
        onToggleFullscreen={vi.fn()}
        tooltipPlacement="top"
      />,
    )

    expect(screen.getByRole('button', { name: 'Stop current process' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear terminal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Session persistence' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Detach into its own window' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Focus pane full screen' })).toBeInTheDocument()
  })

  it('routes Stop and Clear through the correct PTY channel', () => {
    const { rerender } = render(
      <SessionControlButtons
        conn={local}
        sessionId="s1"
        busy
        isAgent={false}
        detach={null}
        onToggleDetach={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Stop current process' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear terminal' }))
    expect(window.omnitermAPI.connect.localInput).toHaveBeenCalledWith('s1', '\x03')
    expect(window.omnitermAPI.connect.localInput).toHaveBeenCalledWith('s1', '\x0c')

    rerender(
      <SessionControlButtons
        conn={ssh}
        sessionId="s2"
        busy
        isAgent={false}
        detach={null}
        onToggleDetach={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Stop current process' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear terminal' }))
    expect(window.omnitermAPI.connect.sshInput).toHaveBeenCalledWith('s2', '\x03')
    expect(window.omnitermAPI.connect.sshInput).toHaveBeenCalledWith('s2', '\x0c')
  })

  it('disables Stop while idle but leaves Clear available', () => {
    render(
      <SessionControlButtons
        conn={local}
        sessionId="s1"
        busy={false}
        isAgent={false}
        detach={null}
        onToggleDetach={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Stop current process' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear terminal' })).toBeEnabled()
  })

  it('omits PTY-only controls for RDP but keeps detach/fullscreen', () => {
    render(
      <SessionControlButtons
        conn={rdp}
        sessionId="s3"
        busy={false}
        isAgent={false}
        detach="detach"
        onToggleDetach={vi.fn()}
        fullscreen={false}
        onToggleFullscreen={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Stop current process' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear terminal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Session persistence' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Detach into its own window' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Focus pane full screen' })).toBeInTheDocument()
  })
})
