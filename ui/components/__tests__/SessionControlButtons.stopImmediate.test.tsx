/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import { mockOmnitermAPI } from '../../testUtils'
import SessionControlButtons from '../SessionControlButtons'

const local: Connection = {
  id: 'local', name: 'Local', type: 'LOCAL', host: '', port: '', user: '',
}

const renderControls = (props: Partial<Parameters<typeof SessionControlButtons>[0]> = {}) => render(
  <SessionControlButtons
    conn={local}
    sessionId="s1"
    detach={null}
    onToggleDetach={vi.fn()}
    {...props}
  />,
)

beforeEach(() => {
  mockOmnitermAPI({
    connect: {
      interruptSession: vi.fn().mockResolvedValue(undefined),
      localInput: vi.fn(),
      sshInput: vi.fn(),
    },
  })
})

describe('SessionControlButtons immediate stop', () => {
  it('stays enabled while the session is live even when the activity probe reads idle', () => {
    renderControls({ busy: false, sessionLive: true })
    expect(screen.getByRole('button', { name: 'Stop current process' })).toBeEnabled()
  })

  it('disables stop when the session is not live', () => {
    renderControls({ busy: true, sessionLive: false })
    expect(screen.getByRole('button', { name: 'Stop current process' })).toBeDisabled()
  })

  it('interrupts the current process immediately without replacing the Stop button', () => {
    renderControls({ busy: true, sessionLive: true })

    fireEvent.click(screen.getByRole('button', { name: 'Stop current process' }))

    expect(window.omnitermAPI.connect.interruptSession).toHaveBeenCalledWith('s1')
    expect(screen.getByRole('button', { name: 'Stop current process' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Force kill/i })).not.toBeInTheDocument()
  })

  it('falls back to ETX if the native interrupt command is unavailable at runtime', async () => {
    const localInput = vi.fn()
    mockOmnitermAPI({
      connect: {
        interruptSession: vi.fn().mockRejectedValue(new Error('old backend')),
        localInput,
      },
    })
    renderControls({ busy: true, sessionLive: true })

    fireEvent.click(screen.getByRole('button', { name: 'Stop current process' }))

    await waitFor(() => expect(localInput).toHaveBeenCalledWith('s1', '\x03'))
  })
})
