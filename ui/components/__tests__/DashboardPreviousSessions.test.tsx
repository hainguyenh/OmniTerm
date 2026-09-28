/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearStoredSessions,
  upsertSession,
  type StoredAgentSession,
} from '../../utils/agentSessionStorage'
import DashboardPreviousSessions from '../DashboardPreviousSessions'
import WaitingPane, { type FallbackNavigatorTarget } from '../WaitingPane'

const UUID = '12345678-1234-1234-1234-123456789abc'

function session(overrides: Partial<StoredAgentSession> = {}): StoredAgentSession {
  return {
    id: `claude:${UUID}`,
    agent: 'claude',
    launcher: 'claude-work',
    profileName: 'claude-work',
    sessionId: UUID,
    cwd: 'D:/repo',
    folderName: 'repo',
    title: 'Feature Work',
    state: 'saved',
    bookmarked: true,
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('DashboardPreviousSessions', () => {
  beforeEach(() => {
    clearStoredSessions()
  })

  it('renders nothing when no stored sessions exist', () => {
    const onResume = vi.fn()
    const { container } = render(<DashboardPreviousSessions onResume={onResume} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders grid layout in non-compact mode and triggers resume', () => {
    const onResume = vi.fn()
    upsertSession(session())
    render(<DashboardPreviousSessions onResume={onResume} compact={false} />)

    expect(screen.getByText('Previous Sessions')).toBeInTheDocument()
    expect(screen.getByText('Feature Work')).toBeInTheDocument()
    expect(screen.getByText('D:/repo')).toBeInTheDocument()

    const resumeBtn = screen.getByRole('button', { name: /Resume claude-work session in repo/i })
    fireEvent.click(resumeBtn)
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it('renders compact list in compact mode', () => {
    const onResume = vi.fn()
    upsertSession(session())
    render(<DashboardPreviousSessions onResume={onResume} compact={true} />)

    expect(screen.getByText('Previous Sessions')).toBeInTheDocument()
    expect(screen.getByText('Feature Work')).toBeInTheDocument()
  })

  it('removes stored session when remove button is clicked', () => {
    const onResume = vi.fn()
    upsertSession(session())
    render(<DashboardPreviousSessions onResume={onResume} />)

    const removeBtn = screen.getByRole('button', { name: /Remove claude-work session in repo from the list/i })
    fireEvent.click(removeBtn)
    expect(screen.queryByText('Feature Work')).not.toBeInTheDocument()
  })

  it('requires confirmation to clear all sessions', () => {
    const onResume = vi.fn()
    upsertSession(session())
    render(<DashboardPreviousSessions onResume={onResume} />)

    const clearBtn = screen.getByRole('button', { name: /Clear all/i })
    fireEvent.click(clearBtn)
    expect(screen.getByText('Click again to confirm')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Click again to confirm/i }))
    expect(screen.queryByText('Feature Work')).not.toBeInTheDocument()
  })
})

describe('WaitingPane fallback navigator', () => {
  it('renders fallback navigation targets and navigates on click', () => {
    const onNavigateTarget = vi.fn()
    const targets: FallbackNavigatorTarget[] = [
      { id: 'view-1', label: 'View 1', openTabCount: 2, color: '#ff0055' },
    ]

    render(
      <WaitingPane
        dark={true}
        compact={false}
        onNewSession={vi.fn()}
        onPickShell={vi.fn()}
        fallbackTargets={targets}
        onNavigateTarget={onNavigateTarget}
      />,
    )

    expect(screen.getByTestId('fallback-navigator')).toBeInTheDocument()
    expect(screen.getByText('You have open terminals in other views:')).toBeInTheDocument()
    const targetBtn = screen.getByRole('button', { name: /View 1/i })
    fireEvent.click(targetBtn)
    expect(onNavigateTarget).toHaveBeenCalledWith('view-1')
  })
})
