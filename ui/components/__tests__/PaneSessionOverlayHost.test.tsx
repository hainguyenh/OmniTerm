/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PaneSessionOverlayHost } from '../PaneSessionOverlayHost'
import { clearStoredSessions, upsertSession } from '../../utils/agentSessionStorage'

const VALID_UUID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  clearStoredSessions()
  localStorage.clear()
})

describe('PaneSessionOverlayHost', () => {
  it('renders nothing when no interrupted session matches this tab', () => {
    const { container } = render(<PaneSessionOverlayHost sessionId="tab-1" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for an active (still-running) session — only interrupted sessions show', () => {
    upsertSession({
      id: `claude:${VALID_UUID}`,
      tabId: 'tab-1',
      agent: 'claude',
      launcher: 'claude-th',
      profileName: 'claude-th',
      sessionId: VALID_UUID,
      state: 'active',
      updatedAt: Date.now(),
    })
    const { container } = render(<PaneSessionOverlayHost sessionId="tab-1" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the overlay for an interrupted session and resumes into a fresh pane', () => {
    upsertSession({
      id: `claude:${VALID_UUID}`,
      tabId: 'tab-1',
      agent: 'claude',
      launcher: 'claude-th',
      profileName: 'claude-th',
      sessionId: VALID_UUID,
      cwd: 'D:/work/proj',
      state: 'interrupted',
      updatedAt: Date.now(),
    })

    const onResumeCommand = vi.fn()
    render(<PaneSessionOverlayHost sessionId="tab-1" onResumeCommand={onResumeCommand} />)

    expect(screen.getByText('Interrupted agent session')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Claude Code/ })).toBeInTheDocument()
    expect(screen.getByText('claude-th')).toBeInTheDocument()

    const resumeBtn = screen.getByRole('button', { name: /Resume Session/i })
    fireEvent.click(resumeBtn)
    expect(onResumeCommand).toHaveBeenCalledWith(`claude-th --resume ${VALID_UUID}`, 'D:/work/proj')
  })

  it('does not offer resume when the launcher is invalid, and dismiss/new-terminal still work', () => {
    upsertSession({
      id: `claude:${VALID_UUID}`,
      tabId: 'tab-2',
      agent: 'claude',
      // A stray or forged entry with a launcher shaped like a shell label must never resume.
      launcher: undefined,
      profileName: 'default',
      sessionId: VALID_UUID,
      state: 'interrupted',
      updatedAt: Date.now(),
    })

    const onNew = vi.fn()
    render(<PaneSessionOverlayHost sessionId="tab-2" onNewSession={onNew} />)

    // With no launcher it falls back to the plain `claude` command, which is still valid — resume shows.
    expect(screen.getByRole('button', { name: /Resume Session/i })).toBeInTheDocument()

    const newBtn = screen.getByRole('button', { name: /New Terminal/i })
    fireEvent.click(newBtn)
    expect(onNew).toHaveBeenCalled()
  })

  it('dismiss hides the overlay without deleting the stored session', () => {
    upsertSession({
      id: `claude:${VALID_UUID}`,
      tabId: 'tab-3',
      agent: 'claude',
      profileName: 'claude',
      sessionId: VALID_UUID,
      state: 'interrupted',
      updatedAt: Date.now(),
    })

    const { rerender } = render(<PaneSessionOverlayHost sessionId="tab-3" />)
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }))

    rerender(<PaneSessionOverlayHost sessionId="tab-3" />)
    expect(screen.queryByText(/Interrupted agent session/)).toBeNull()
  })
})
