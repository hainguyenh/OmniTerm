/**
 * @vitest-environment jsdom
 */
import { createRef } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'

import PaneHeader from '../PaneHeader'
import { resetPanePresenceForTests, setPanePresence } from '../../utils/agentPresenceStore'
import { clearStoredSessions, isBookmarkPending, loadStoredSessions, upsertSession } from '../../utils/agentSessionStorage'
import { resetAgentSessionDurableForTests } from '../../utils/agentSessionDurable'
import { DEFAULT_QUOTA_CONFIG } from '../../../plugins/agent-quota/app/quotaConfig'
import { resetQuotaStore, updateQuota } from '../../../plugins/agent-quota/app/quotaStore'

const UUID = '12345678-1234-1234-1234-123456789abc'
const local: Connection = { id: 'c1', name: 'PowerShell', type: 'LOCAL', host: '', port: '', user: '', shell: 'powershell', localCwd: 'D:/repo' }

function setup(overrides: Partial<React.ComponentProps<typeof PaneHeader>> = {}) {
  const props: React.ComponentProps<typeof PaneHeader> = {
    paneIndex: 0, conn: local, focused: true, sessionId: 'tab-1', tabs: [{ id: 'tab-1', connId: 'c1', name: 'x' }],
    panes: ['tab-1'], layoutMode: 2, statuses: { 'tab-1': 'connected' }, connType: () => 'LOCAL',
    pickerOpen: false, pickerRef: createRef<HTMLDivElement>(), detach: null, onToggleDetach: vi.fn(),
    onFocus: vi.fn(), onDragStart: vi.fn(), onDragEnd: vi.fn(), onTogglePicker: vi.fn(),
    onAssign: vi.fn(), onClear: vi.fn(), liveFolder: 'repo', ...overrides,
  }
  return { ...render(<PaneHeader {...props} />), props }
}

beforeEach(() => {
  resetAgentSessionDurableForTests()
  resetPanePresenceForTests()
  window.omnitermAPI = { connect: { localInput: vi.fn() } } as unknown as typeof window.omnitermAPI
  clearStoredSessions()
  localStorage.clear()
  resetQuotaStore()
})

describe('PaneHeader agent identity', () => {
  it('titles an agent pane with its work item and puts the bookmark right after it', () => {
    setPanePresence({ 'tab-1': { agent: 'claude', profileName: 'claude-work', pid: 1, startTime: 1 } })
    setup({ sessionTitle: '✳ Fix header status' })

    const title = screen.getByTestId('pane-header-title')
    const [primary, bookmark] = Array.from(title.children)
    expect(primary).toHaveTextContent('Fix header status')
    expect(bookmark).toHaveAttribute('aria-label', 'Bookmark session')
    expect(within(title).getByText('· repo')).toBeInTheDocument()
    // The agent is an icon; its name is only in the tooltip / accessible name.
    expect(screen.getByRole('img', { name: 'Claude Code · profile claude-work' })).toBeInTheDocument()
    expect(screen.queryByText('Claude Code')).toBeNull()
  })

  it('does not repeat the folder after the bookmark when the title only names the folder (regression)', () => {
    setPanePresence({ 'tab-1': { agent: 'claude', profileName: 'claude', pid: 1, startTime: 1 } })
    setup({ sessionTitle: 'repo', folderPath: 'D:/repo', onOpenFolder: vi.fn() })

    const title = screen.getByTestId('pane-header-title')
    expect(within(title).getAllByText(/repo/)).toHaveLength(1)
    expect(within(title).queryByText('· repo')).toBeNull()
    expect(within(title).getByRole('button', { name: 'Bookmark session' })).toBeInTheDocument()
  })

  it('detects an agent started after the pane mounted, from the shared presence store (regression)', () => {
    setup({ sessionTitle: '✳ Plan the fix' })
    expect(screen.queryByRole('button', { name: 'Bookmark session' })).toBeNull()

    act(() => setPanePresence({ 'tab-1': { agent: 'claude', profileName: 'claude', pid: 1, startTime: 1 } }))
    expect(screen.getByRole('button', { name: 'Bookmark session' })).toBeInTheDocument()
  })

  it('keeps the bookmark state from the store, not a 2-second timer (regression)', () => {
    setPanePresence({ 'tab-1': { agent: 'claude', profileName: 'claude-work', pid: 1, startTime: 1, claudeSessionId: UUID } })
    upsertSession({
      id: `claude:${UUID}`, tabId: 'tab-1', agent: 'claude', profileName: 'claude-work', sessionId: UUID,
      state: 'active', updatedAt: Date.now(),
    })
    setup({ sessionTitle: '✳ Task' })

    fireEvent.click(screen.getByRole('button', { name: 'Bookmark session' }))
    expect(loadStoredSessions()[0].bookmarked).toBe(true)
    expect(screen.getByRole('button', { name: 'Remove bookmark' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Remove bookmark' }))
    expect(loadStoredSessions()[0].bookmarked).toBe(false)
  })

  it('queues a bookmark while the session id is not resolved yet', () => {
    setPanePresence({ 'tab-1': { agent: 'claude', profileName: 'claude-work', pid: 1, startTime: 1 } })
    setup({ sessionTitle: '✳ Task' })
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark session' }))
    expect(isBookmarkPending('tab-1')).toBe(true)
    expect(screen.getByRole('button', { name: 'Bookmark session' })).toHaveAttribute('data-bookmark-state', 'pending')
  })

  it('has a renew button in the terminal header for local panes only', () => {
    const { rerender, props } = setup()
    expect(screen.getByTestId('pane-renew-session-button')).toBeInTheDocument()
    rerender(<PaneHeader {...props} conn={{ ...local, type: 'SSH', host: 'h' }} />)
    expect(screen.queryByTestId('pane-renew-session-button')).toBeNull()
  })

  it('drops pane arrangement chrome in single view', () => {
    setup({ single: true, layoutMode: 1, onClose: vi.fn() })
    expect(screen.queryByLabelText('Choose session for this pane')).toBeNull()
    expect(screen.queryByLabelText('Close pane')).toBeNull()
    expect(screen.queryByText('1')).toBeNull()
    expect(screen.getByTestId('pane-renew-session-button')).toBeInTheDocument()
  })

  it('keeps renew in an anchored group that busy/idle changes cannot move (regression)', () => {
    setPanePresence({ 'tab-1': { agent: 'claude', profileName: 'claude-work', pid: 1, startTime: 1 } })
    const { rerender, props } = setup({ sessionTitle: '✳ Task', busy: false, onClose: vi.fn() })
    const anchored = screen.getByTestId('pane-header-anchored')
    expect(within(anchored).getByTestId('pane-renew-session-button')).toBeInTheDocument()
    expect(within(anchored).getByLabelText('Close pane')).toBeInTheDocument()
    // The status lives in the title's activity zone, never next to the controls.
    const zone = screen.getByTestId('pane-activity-zone')
    expect(within(zone).getByLabelText('Idle')).toBeInTheDocument()

    rerender(<PaneHeader {...props} busy />)
    expect(zone.querySelector('.animate-running-dot-oscillate')).toBeInTheDocument()
    expect(within(screen.getByTestId('pane-header-anchored')).getByTestId('pane-renew-session-button')).toBeInTheDocument()
  })

  it('shows the agent loading artwork in the activity zone only when it is turned on', () => {
    setPanePresence({ 'tab-1': { agent: 'claude', profileName: 'claude-work', pid: 1, startTime: 1 } })
    const { rerender, props } = setup({ sessionTitle: '✳ Task', busy: true })
    expect(screen.getByTestId('pane-activity-zone').querySelector('img')).toBeNull()

    act(() => updateQuota((state) => ({
      ...state,
      config: { ...DEFAULT_QUOTA_CONFIG, display: { ...DEFAULT_QUOTA_CONFIG.display, customArtSession: true, animations: true } },
    })))
    rerender(<PaneHeader {...props} busy />)
    const art = screen.getByTestId('pane-activity-zone').querySelector('.aq-busy-art')
    expect(art).toHaveAttribute('data-loading-tier', 'onTrack')
    expect(art?.querySelector('img')).toBeInTheDocument()
  })
})
