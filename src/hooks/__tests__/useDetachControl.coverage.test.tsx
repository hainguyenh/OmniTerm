/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import { useDetachControl, type UseDetachControlInput } from '../useDetachControl'

const local: Connection = { id: 'local', name: 'Local', type: 'LOCAL', host: '', port: '', user: '' }
const ssh: Connection = { id: 'ssh', name: 'SSH', type: 'SSH', host: 'example.com', port: '22', user: 'me' }
const rdp: Connection = { id: 'rdp', name: 'RDP', type: 'RDP', host: 'example.com', port: '3389', user: 'me' }

function setup(overrides: Partial<UseDetachControlInput> = {}) {
  const connections: Record<string, Connection> = { local, ssh, rdp }
  const input: UseDetachControlInput = {
    tabs: [
      { id: 'local-tab', connId: 'local' },
      { id: 'ssh-tab', connId: 'ssh' },
      { id: 'rdp-tab', connId: 'rdp' },
      { id: 'missing-tab', connId: 'missing' },
      { id: 'editor-tab' },
    ],
    connById: id => id ? connections[id] : undefined,
    isEditorTab: id => id === 'editor-tab',
    statuses: {
      'local-tab': 'connected',
      'ssh-tab': 'connected',
      'rdp-tab': 'connected',
      'missing-tab': 'connected',
    },
    rdpDetached: {},
    poppedOut: {},
    canDetachWindow: true,
    onRdpToggle: vi.fn(),
    onPopOut: vi.fn(),
    onAttach: vi.fn(),
    ...overrides,
  }
  return { input, ...renderHook((props: UseDetachControlInput) => useDetachControl(props), { initialProps: input }) }
}

describe('useDetachControl', () => {
  beforeEach(() => vi.clearAllMocks())

  it('omits controls for null, editor, missing, disconnected, and unsupported sessions', () => {
    const { result, rerender, input } = setup()
    expect(result.current.stateOf(null)).toBeNull()
    expect(result.current.stateOf('editor-tab')).toBeNull()
    expect(result.current.stateOf('missing-tab')).toBeNull()
    expect(result.current.stateOf('unknown')).toBeNull()

    rerender({ ...input, statuses: { ...input.statuses, 'local-tab': 'closed' } })
    expect(result.current.stateOf('local-tab')).toBeNull()

    rerender({ ...input, canDetachWindow: false })
    expect(result.current.stateOf('local-tab')).toBeNull()
  })

  it('reports detach for connected docked local and SSH sessions and pops them out', () => {
    const { result, input } = setup()
    expect(result.current.stateOf('local-tab')).toBe('detach')
    expect(result.current.stateOf('ssh-tab')).toBe('detach')

    act(() => {
      result.current.toggle('local-tab')
      result.current.toggle('ssh-tab')
    })
    expect(input.onPopOut).toHaveBeenCalledWith('local-tab')
    expect(input.onPopOut).toHaveBeenCalledWith('ssh-tab')
    expect(input.onAttach).not.toHaveBeenCalled()
  })

  it('reports attach for an existing popped-out session and reattaches it', () => {
    const { result, input } = setup({ poppedOut: { 'ssh-tab': true } })
    expect(result.current.stateOf('ssh-tab')).toBe('attach')
    act(() => result.current.toggle('ssh-tab'))
    expect(input.onAttach).toHaveBeenCalledWith('ssh-tab')
    expect(input.onPopOut).not.toHaveBeenCalled()
  })

  it('always routes RDP controls through the native RDP toggle', () => {
    const { result, rerender, input } = setup()
    expect(result.current.stateOf('rdp-tab')).toBe('detach')
    act(() => result.current.toggle('rdp-tab'))
    expect(input.onRdpToggle).toHaveBeenCalledWith('rdp-tab')

    rerender({ ...input, rdpDetached: { 'rdp-tab': true } })
    expect(result.current.stateOf('rdp-tab')).toBe('attach')
    act(() => result.current.toggle('rdp-tab'))
    expect(input.onRdpToggle).toHaveBeenCalledTimes(2)
    expect(input.onAttach).not.toHaveBeenCalled()
  })

  it('does nothing when toggle has no valid action', () => {
    const { result, input } = setup()
    act(() => {
      result.current.toggle(null)
      result.current.toggle('editor-tab')
      result.current.toggle('missing-tab')
    })
    expect(input.onRdpToggle).not.toHaveBeenCalled()
    expect(input.onPopOut).not.toHaveBeenCalled()
    expect(input.onAttach).not.toHaveBeenCalled()
  })
})
