/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BookmarksPanel from '../BookmarksPanel'
import { clearPins, loadPins } from '../../utils/agentBookmarkPins'
import { clearStoredSessions, loadStoredSessions, upsertSession } from '../../utils/agentSessionStorage'
import { resetAgentSessionDurableForTests } from '../../utils/agentSessionDurable'

const UUID = '12345678-1234-1234-1234-123456789abc'

function renderPanel() {
  const props = {
    onLaunch: vi.fn(),
    onShowTab: vi.fn(),
    launchCommandFor: vi.fn(() => 'claude-work'),
  }
  return { props, ...render(<BookmarksPanel {...props} />) }
}

beforeEach(() => {
  resetAgentSessionDurableForTests()
  window.omnitermAPI = { app: { openInSystem: vi.fn() } } as unknown as typeof window.omnitermAPI
  clearStoredSessions()
  clearPins()
  localStorage.clear()
})

describe('BookmarksPanel', () => {
  it('explains how to bookmark when there is nothing yet', () => {
    renderPanel()
    expect(screen.getByText('No bookmarks yet')).toBeInTheDocument()
    expect(screen.getByText(/bookmark icon next to an AI agent's title/)).toBeInTheDocument()
  })

  it('lists a bookmarked session under its profile and resumes it in its folder with its profile', () => {
    upsertSession({
      id: `claude:${UUID}`, agent: 'claude', launcher: 'claude-work', profileName: 'claude-work', sessionId: UUID,
      cwd: 'D:/repo', folderName: 'repo', title: 'Fix header status', state: 'saved', bookmarked: true, updatedAt: Date.now(),
    })
    const { props } = renderPanel()

    expect(screen.getByRole('region', { name: 'Profile claude-work' })).toBeInTheDocument()
    expect(screen.getByText('Fix header status')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resume Fix header status' }))
    expect(props.onLaunch).toHaveBeenCalledWith(`claude-work --resume ${UUID}`, 'D:/repo')
    // Resuming a bookmark keeps it: the resumed pane re-binds to the same entry.
    expect(loadStoredSessions()).toHaveLength(1)
  })

  it('shows a running bookmarked session instead of resuming a second copy', () => {
    upsertSession({
      id: `claude:${UUID}`, tabId: 'tab-7', agent: 'claude', profileName: 'claude-work', sessionId: UUID,
      cwd: 'D:/repo', state: 'active', bookmarked: true, updatedAt: Date.now(),
    })
    const { props } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /^Show / }))
    expect(props.onShowTab).toHaveBeenCalledWith('tab-7')
  })

  it('pins a profile + folder and launches a fresh agent there', () => {
    upsertSession({
      id: `claude:${UUID}`, agent: 'claude', launcher: 'claude-work', profileName: 'claude-work', sessionId: UUID,
      cwd: 'D:/repo', folderName: 'repo', state: 'saved', bookmarked: true, updatedAt: Date.now(),
    })
    const { props } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Pin repo' }))
    expect(loadPins()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Open claude-work in repo' }))
    expect(props.onLaunch).toHaveBeenCalledWith('claude-work', 'D:/repo')
  })

  it('removes a bookmark from the list', () => {
    upsertSession({
      id: `claude:${UUID}`, agent: 'claude', profileName: 'claude-work', sessionId: UUID,
      cwd: 'D:/repo', title: 'Old task', state: 'saved', bookmarked: true, updatedAt: Date.now(),
    })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Remove bookmark Old task' }))
    expect(loadStoredSessions()).toHaveLength(0)
  })
})
