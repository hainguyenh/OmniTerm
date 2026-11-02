/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { installTerminalInterruptReset, interruptSessionProcess } from '../terminalInterruptReset'

const createTerminal = (bufferType: 'normal' | 'alternate' = 'normal') => ({
  buffer: { active: { type: bufferType } },
  write: vi.fn(),
})

describe('installTerminalInterruptReset', () => {
  it('ignores interrupt events for a different session id', () => {
    const terminal = createTerminal()
    installTerminalInterruptReset(terminal, 's1')

    window.dispatchEvent(new CustomEvent('omniterm:terminal-interrupted', { detail: { id: 's2' } }))

    expect(terminal.write).not.toHaveBeenCalled()
  })

  it('writes a mode-reset sequence without exiting the alt screen when not in it', () => {
    const terminal = createTerminal('normal')
    installTerminalInterruptReset(terminal, 's1')

    window.dispatchEvent(new CustomEvent('omniterm:terminal-interrupted', { detail: { id: 's1' } }))

    expect(terminal.write).toHaveBeenCalledTimes(1)
    const written = terminal.write.mock.calls[0][0] as string
    expect(written).toContain('\x1b[?1000l')
    expect(written).toContain('\x1b[?2004l')
    expect(written).toContain('\x1b[?25h')
    expect(written).not.toContain('\x1b[?1049l')
  })

  it('also exits the alternate screen when the pane is currently in it', () => {
    const terminal = createTerminal('alternate')
    installTerminalInterruptReset(terminal, 's1')

    window.dispatchEvent(new CustomEvent('omniterm:terminal-interrupted', { detail: { id: 's1' } }))

    const written = terminal.write.mock.calls[0][0] as string
    expect(written).toContain('\x1b[?1049l')
  })

  it('stops listening after dispose', () => {
    const terminal = createTerminal()
    const handle = installTerminalInterruptReset(terminal, 's1')
    handle.dispose()

    window.dispatchEvent(new CustomEvent('omniterm:terminal-interrupted', { detail: { id: 's1' } }))

    expect(terminal.write).not.toHaveBeenCalled()
  })
})

describe('interruptSessionProcess', () => {
  it('interrupts local session and emits terminal-interrupted event', () => {
    const interruptSession = vi.fn().mockResolvedValue(undefined)
    window.omnitermAPI = {
      ...window.omnitermAPI,
      connect: {
        ...window.omnitermAPI?.connect,
        interruptSession,
      } as any,
    }
    const listener = vi.fn()
    window.addEventListener('omniterm:terminal-interrupted', listener)

    interruptSessionProcess('sess-local-1', 'LOCAL')

    expect(interruptSession).toHaveBeenCalledWith('sess-local-1')
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: { id: 'sess-local-1' } }))
    window.removeEventListener('omniterm:terminal-interrupted', listener)
  })

  it('falls back to localInput ETX when interruptSession fails', async () => {
    const localInput = vi.fn()
    window.omnitermAPI = {
      ...window.omnitermAPI,
      connect: {
        ...window.omnitermAPI?.connect,
        interruptSession: vi.fn().mockRejectedValue(new Error('unsupported')),
        localInput,
      } as any,
    }

    interruptSessionProcess('sess-local-2', 'LOCAL')

    await vi.waitFor(() => expect(localInput).toHaveBeenCalledWith('sess-local-2', '\x03'))
  })

  it('sends ETX and emits event for SSH session', () => {
    const sshInput = vi.fn()
    window.omnitermAPI = {
      ...window.omnitermAPI,
      connect: {
        ...window.omnitermAPI?.connect,
        sshInput,
      } as any,
    }
    const listener = vi.fn()
    window.addEventListener('omniterm:terminal-interrupted', listener)

    interruptSessionProcess('sess-ssh-1', 'SSH')

    expect(sshInput).toHaveBeenCalledWith('sess-ssh-1', '\x03')
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: { id: 'sess-ssh-1' } }))
    window.removeEventListener('omniterm:terminal-interrupted', listener)
  })
})
