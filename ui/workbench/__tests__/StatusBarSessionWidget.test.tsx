/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Session = { id: string; connType: string; status: string }

const h = vi.hoisted(() => ({
  tabs: { activePane: 'p1', panes: {} as Record<string, { active: string | null; tabs: Array<{ id: string; input: unknown }> }> },
  sessions: [] as Session[],
  api: null as null | { reconnect: (id: string) => void; killSession: (id: string) => void },
  live: { latencies: {} as Record<string, number>, metrics: {} as Record<string, { latency?: number }>, connectedAt: {} as Record<string, number> },
  presence: null as null | { modelInfo?: { display: string } },
  chips: vi.fn(),
}))

vi.mock('../../features/agent-quota/paneHosts', () => ({ FrozenSessionStatus: () => <i data-testid="frozen" /> }))
vi.mock('../../components/SessionMetricsChips', () => ({
  default: (props: unknown) => {
    h.chips(props)
    return <i data-testid="chips" />
  },
}))
vi.mock('../../ide/editor/core/controller', () => ({ useTabs: (select: (s: unknown) => unknown) => select(h.tabs) }))
vi.mock('../../utils/agentPresenceStore', () => ({ usePanePresence: () => h.presence }))
vi.mock('../sessions/sessionBridge', () => ({
  useSessionBridge: (select: (s: unknown) => unknown) => select({ sessions: h.sessions, api: h.api }),
}))
vi.mock('../sessions/sessionInput', () => ({ parseSessionInput: (input: unknown) => (input as { session?: string } | undefined)?.session ?? null }))
vi.mock('../sessions/sessionLive', () => ({ useSessionLive: () => h.live }))

import { StatusBarSessionWidget } from '../StatusBarSessionWidget'

function activeSession(id: string | null) {
  h.tabs = {
    activePane: 'p1',
    panes: { p1: { active: id ? 't1' : null, tabs: id ? [{ id: 't1', input: { session: id } }] : [{ id: 't0', input: { file: 'a' } }] } },
  }
}

describe('StatusBarSessionWidget', () => {
  beforeEach(() => {
    h.sessions = [{ id: 's1', connType: 'LOCAL', status: 'connected' }]
    h.api = { reconnect: vi.fn(), killSession: vi.fn() }
    h.live = { latencies: {}, metrics: {}, connectedAt: {} }
    h.presence = null
    h.chips.mockClear()
    activeSession('s1')
  })
  afterEach(cleanup)

  it('shows nothing when the active tab is not a session or the session is unknown', () => {
    activeSession(null)
    expect(render(<StatusBarSessionWidget />).container).toBeEmptyDOMElement()
    cleanup()
    activeSession('ghost')
    expect(render(<StatusBarSessionWidget />).container).toBeEmptyDOMElement()
    cleanup()
    h.tabs = { activePane: 'missing', panes: {} }
    expect(render(<StatusBarSessionWidget />).container).toBeEmptyDOMElement()
  })

  it('shows a local session with its agent model and no remote controls', () => {
    h.presence = { modelInfo: { display: 'Opus 5' } }
    render(<StatusBarSessionWidget />)
    expect(screen.getByTestId('status-bar-session')).toHaveAttribute('data-session', 's1')
    expect(screen.getByText('Opus 5')).toBeInTheDocument()
    expect(screen.queryByTestId('chips')).toBeNull()
    expect(screen.queryByText('Disconnect')).toBeNull()
    expect(screen.queryByText('Reconnect')).toBeNull()
  })

  it('omits the model line when the agent reports none', () => {
    h.presence = {}
    render(<StatusBarSessionWidget />)
    expect(screen.queryByTitle(/AI Agent Model/)).toBeNull()
  })

  it('shows link metrics and a Disconnect button for a live remote session', () => {
    h.sessions = [{ id: 's1', connType: 'SSH', status: 'connected' }]
    h.live = { latencies: {}, metrics: { s1: { latency: 42 } }, connectedAt: { s1: 7 } }
    render(<StatusBarSessionWidget />)
    expect(h.chips).toHaveBeenCalledWith(expect.objectContaining({ latency: 42, connectedAt: 7, compact: true }))
    fireEvent.click(screen.getByText('Disconnect'))
    expect(h.api?.killSession).toHaveBeenCalledWith('s1')
  })

  it('reads the latency of an RDP session from its own table and tolerates missing data', () => {
    h.sessions = [{ id: 's1', connType: 'RDP', status: 'connected' }]
    h.live = { latencies: { s1: 15 }, metrics: {}, connectedAt: {} }
    render(<StatusBarSessionWidget />)
    expect(h.chips).toHaveBeenLastCalledWith(expect.objectContaining({ latency: 15 }))
    cleanup()
    h.live = { latencies: {}, metrics: {}, connectedAt: {} }
    render(<StatusBarSessionWidget />)
    expect(h.chips).toHaveBeenLastCalledWith(expect.objectContaining({ latency: null }))
    cleanup()
    h.sessions = [{ id: 's1', connType: 'SSH', status: 'connected' }]
    render(<StatusBarSessionWidget />)
    expect(h.chips).toHaveBeenLastCalledWith(expect.objectContaining({ latency: null }))
  })

  it.each(['closed', 'error'])('offers Reconnect for a %s session and not Disconnect', (status) => {
    h.sessions = [{ id: 's1', connType: 'SSH', status }]
    render(<StatusBarSessionWidget />)
    fireEvent.click(screen.getByText('Reconnect'))
    expect(h.api?.reconnect).toHaveBeenCalledWith('s1')
    expect(screen.queryByText('Disconnect')).toBeNull()
  })

  it('offers no actions without a session bridge', () => {
    h.api = null
    h.sessions = [{ id: 's1', connType: 'SSH', status: 'closed' }]
    render(<StatusBarSessionWidget />)
    expect(screen.queryByText('Reconnect')).toBeNull()
    cleanup()
    h.sessions = [{ id: 's1', connType: 'SSH', status: 'connected' }]
    render(<StatusBarSessionWidget />)
    expect(screen.queryByText('Disconnect')).toBeNull()
  })
})
