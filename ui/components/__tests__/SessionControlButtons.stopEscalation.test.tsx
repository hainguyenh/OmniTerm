/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  vi.useFakeTimers()
  mockOmnitermAPI({
    connect: {
      localInput: vi.fn(),
      sshInput: vi.fn(),
      forceKillSession: vi.fn().mockResolvedValue(undefined),
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SessionControlButtons stop escalation', () => {
  it('stays enabled while the session is live even when the probe reads idle', () => {
    renderControls({ busy: false, sessionLive: true })
    const button = screen.getByRole('button', { name: 'Stop current process' })
    expect(button).not.toBeDisabled()
  })

  it('disables stop when the session is not live', () => {
    renderControls({ busy: true, sessionLive: false })
    expect(screen.getByRole('button', { name: 'Stop current process' })).toBeDisabled()
  })

  it('sends SIGINT immediately and only offers Force kill after the escalation delay', () => {
    const localInput = vi.fn()
    mockOmnitermAPI({ connect: { localInput, forceKillSession: vi.fn().mockResolvedValue(undefined) } })
    renderControls({ busy: true, sessionLive: true })

    fireEvent.click(screen.getByRole('button', { name: 'Stop current process' }))
    expect(localInput).toHaveBeenCalledWith('s1', '\x03')
    expect(screen.queryByRole('button', { name: 'Force kill session' })).not.toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(2999) })
    expect(screen.queryByRole('button', { name: 'Force kill session' })).not.toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(1) })
    const force = screen.getByRole('button', { name: 'Force kill session' })
    fireEvent.click(force)
    expect(window.omnitermAPI.connect.forceKillSession).toHaveBeenCalledWith('s1')
  })

  it('keeps the original Stop control mounted and swaps its meaning to Force kill', () => {
    renderControls({ busy: true, sessionLive: true })
    fireEvent.click(screen.getByRole('button', { name: 'Stop current process' }))
    act(() => { vi.advanceTimersByTime(3000) })
    // Same slot, escalated label: one stop-shaped control total.
    expect(screen.queryByRole('button', { name: 'Stop current process' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Force kill session' })).not.toBeDisabled()
  })

  it('resets the escalation timer when the session id changes', () => {
    const localInput = vi.fn()
    mockOmnitermAPI({ connect: { localInput, forceKillSession: vi.fn().mockResolvedValue(undefined) } })
    const view = renderControls({ busy: true, sessionLive: true })

    fireEvent.click(screen.getByRole('button', { name: 'Stop current process' }))
    view.rerender(
      <SessionControlButtons conn={local} sessionId="s2" busy sessionLive detach={null} onToggleDetach={vi.fn()} />,
    )
    act(() => { vi.advanceTimersByTime(3000) })
    // New session starts fresh: no stale armed escalation from the previous id.
    expect(screen.queryByRole('button', { name: 'Force kill session' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop current process' }))
    expect(localInput).toHaveBeenLastCalledWith('s2', '\x03')
  })

  it('disarms a stale escalation when the process exits so the next Stop sends Ctrl+C again', () => {
    const localInput = vi.fn()
    mockOmnitermAPI({ connect: { localInput, forceKillSession: vi.fn().mockResolvedValue(undefined) } })
    const view = renderControls({ busy: true, sessionLive: true })

    fireEvent.click(screen.getByRole('button', { name: 'Stop current process' }))
    act(() => { vi.advanceTimersByTime(3000) })
    // The probe reports idle once the process actually exited; escalation must not survive it.
    view.rerender(
      <SessionControlButtons conn={local} sessionId="s1" busy={false} sessionLive detach={null} onToggleDetach={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Stop current process' })).toBeInTheDocument()

    // A new process starts and the user presses Stop again: Ctrl+C, not an instant teardown.
    view.rerender(
      <SessionControlButtons conn={local} sessionId="s1" busy sessionLive detach={null} onToggleDetach={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Stop current process' }))
    expect(localInput).toHaveBeenLastCalledWith('s1', '\x03')
    expect(window.omnitermAPI.connect.forceKillSession).not.toHaveBeenCalled()
  })

  it('does not fire Force kill after unmount', () => {
    const forceKillSession = vi.fn().mockResolvedValue(undefined)
    mockOmnitermAPI({ connect: { localInput: vi.fn(), forceKillSession } })
    const view = renderControls({ busy: true, sessionLive: true })

    fireEvent.click(screen.getByRole('button', { name: 'Stop current process' }))
    view.unmount()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(forceKillSession).not.toHaveBeenCalled()
  })

  it('reports a failed force kill through the provided callback', async () => {
    const onForceKillError = vi.fn()
    mockOmnitermAPI({
      connect: {
        localInput: vi.fn(),
        forceKillSession: vi.fn().mockRejectedValue(new Error('daemon gone')),
      },
    })
    renderControls({ busy: true, sessionLive: true, onForceKillError })

    fireEvent.click(screen.getByRole('button', { name: 'Stop current process' }))
    await act(async () => { vi.advanceTimersByTime(3000) })
    fireEvent.click(screen.getByRole('button', { name: 'Force kill session' }))
    await vi.waitFor(() => expect(onForceKillError).toHaveBeenCalledWith(expect.any(Error)))
  })
})
