/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  groups: { sessionId: null as string | null, active: null as { profileName: string } | null, groups: [] as unknown[] },
  dock: 'left' as string,
  setQuotaDock: vi.fn(),
  sessions: [] as Array<{ id: string; name: string }>,
}))

vi.mock('../useQuotaGroups', () => ({ useQuotaGroups: () => state.groups }))
vi.mock('../quotaDockState', () => ({
  useQuotaDock: () => state.dock,
  setQuotaDock: (dock: string) => state.setQuotaDock(dock),
}))
vi.mock('../../sessions/sessionBridge', () => ({
  useSessionBridge: (select: (s: { sessions: Array<{ id: string; name: string }> }) => unknown) => select({ sessions: state.sessions }),
}))
vi.mock('../quotaWorkbench.css', () => ({}))

import { QuotaBody, QuotaDockButtons, QuotaToolWindow } from '../QuotaPanel'

const row = (over: Partial<{ key: string; name: string; pct: number | null; detail: string; active: boolean }> = {}) => ({
  key: 'k', name: 'work', pct: 40, detail: '5h window', active: false, ...over,
})

describe('QuotaBody', () => {
  beforeEach(() => {
    state.groups = { sessionId: null, active: null, groups: [] }
    state.sessions = []
  })
  afterEach(cleanup)

  it('explains an empty panel and a tab that is not an agent session', () => {
    render(<QuotaBody />)
    expect(screen.getByText(/No agent profile has been seen yet/)).toBeInTheDocument()
    expect(screen.getByText(/Active tab is not an agent session/)).toBeInTheDocument()
  })

  it('shows the active session and marks its profile', () => {
    state.sessions = [{ id: 's1', name: 'Build tab' }]
    state.groups = {
      sessionId: 's1',
      active: { profileName: 'work' },
      groups: [
        { agent: 'claude', name: 'Claude', active: true, profiles: [row({ active: true }), row({ key: 'k2', name: 'home', pct: null })] },
        { agent: 'codex', name: 'Codex', active: false, profiles: [row({ key: 'c', name: 'solo', active: true })] },
      ],
    }
    render(<QuotaBody />)
    expect(screen.getByText('Build tab')).toBeInTheDocument()
    expect(screen.getByText('active session')).toBeInTheDocument()
    expect(screen.getByText('● work')).toBeInTheDocument()
    expect(screen.getByText('solo')).toBeInTheDocument()
    expect(screen.getByText('2 profiles')).toBeInTheDocument()
    expect(screen.getByText('1 profile')).toBeInTheDocument()
    expect(screen.getByText('–')).toBeInTheDocument()
    expect(screen.getAllByText('40%')).toHaveLength(2)
    expect(screen.queryByText(/No agent profile/)).toBeNull()
  })

  it('falls back to the session id when the bridge does not know the session', () => {
    state.groups = {
      sessionId: 'ghost',
      active: { profileName: 'work' },
      groups: [{ agent: 'claude', name: 'Claude', active: true, profiles: [row()] }],
    }
    render(<QuotaBody />)
    expect(screen.getByText('ghost')).toBeInTheDocument()
  })

  it('renders the same body inside the tool window', () => {
    render(<QuotaToolWindow />)
    expect(screen.getByTestId('quota-body')).toBeInTheDocument()
  })
})

describe('QuotaDockButtons', () => {
  beforeEach(() => state.setQuotaDock.mockClear())
  afterEach(cleanup)

  it('marks the current dock and moves quota on click', () => {
    state.dock = 'footer'
    render(<QuotaDockButtons />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(5)
    expect(screen.getByLabelText('Move quota to: footer status line')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Move quota to: left tool window')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByLabelText('Move quota to: right tool window'))
    expect(state.setQuotaDock).toHaveBeenCalledWith('right')
  })

  it('treats "both" as the right tool window being pressed', () => {
    state.dock = 'both'
    render(<QuotaDockButtons />)
    expect(screen.getByLabelText('Move quota to: right tool window')).toHaveAttribute('aria-pressed', 'true')
  })
})
