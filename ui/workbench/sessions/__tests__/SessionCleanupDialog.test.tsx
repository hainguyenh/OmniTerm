/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))

import { clearStoredSessions, loadStoredSessions, upsertSession } from '../../../utils/agentSessionStorage'
import { SessionCleanupOverlay } from '../SessionCleanupDialog'
import { useSessionCleanup } from '../sessionCleanupStore'

const OLD = '11111111-1111-4111-8111-111111111111'
const OPEN = '22222222-2222-4222-8222-222222222222'
const LISTED = '33333333-3333-4333-8333-333333333333'
const DAY = 86_400_000

const listing = [
  { id: `claude:claude:${OLD}`, agent: 'claude', profile: 'claude', sessionId: OLD, cwd: 'D:/work/app', title: 'Old work', lastActive: Date.now() - 40 * DAY, size: 4096 },
  { id: `claude:claude-work:${OPEN}`, agent: 'claude', profile: 'claude-work', sessionId: OPEN, cwd: 'D:/work/site', title: 'Running now', lastActive: Date.now(), size: 1024 },
  { id: 'codex:codex:x', agent: 'codex', profile: 'codex', sessionId: 'x', cwd: null, title: 'Codex run', lastActive: Date.now() - DAY, size: 10 },
]

function setup() {
  act(() => useSessionCleanup.getState().setOpen(true))
  return render(<SessionCleanupOverlay />)
}

describe('SessionCleanupDialog', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStoredSessions()
    invokeMock.mockReset()
    invokeMock.mockImplementation(async (command: string, args?: { ids: string[] }) => {
      if (command === 'agent_session_files_list') return listing
      if (command === 'agent_session_files_delete') return { deleted: args?.ids ?? [], failed: [] }
      throw new Error(command)
    })
    upsertSession({ id: `claude:${OPEN}`, agent: 'claude', profileName: 'claude-work', sessionId: OPEN, state: 'active', tabId: 't1', updatedAt: Date.now() })
    upsertSession({
      id: `claude:${LISTED}`,
      agent: 'claude',
      profileName: 'claude',
      sessionId: LISTED,
      state: 'interrupted',
      tabId: 't2',
      title: 'Remembered',
      updatedAt: Date.now() - 2 * DAY,
    })
  })

  it('lists files and remembered sessions most recently active first; open sessions cannot be picked', async () => {
    setup()
    const rows = await screen.findAllByTestId('session-cleanup-row')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Running now'),
      expect.stringContaining('Codex run'),
      expect.stringContaining('Remembered'),
      expect.stringContaining('Old work'),
    ])
    expect((screen.getByLabelText('Select Running now') as HTMLInputElement).disabled).toBe(true)
  })

  it('deletes the selected sessions after a confirmation and forgets their OmniTerm entry', async () => {
    setup()
    await screen.findAllByTestId('session-cleanup-row')
    fireEvent.click(screen.getByLabelText('Select all'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete…' }))
    expect(screen.getByTestId('session-cleanup-status').textContent).toContain('Delete 3 sessions')
    expect(invokeMock).not.toHaveBeenCalledWith('agent_session_files_delete', expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Delete Permanently' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('agent_session_files_delete', { ids: ['codex:codex:x', `claude:claude:${OLD}`] }))
    await waitFor(() => expect(screen.getByTestId('session-cleanup-status').textContent).toContain('Deleted 3 sessions'))
    expect(loadStoredSessions().map((entry) => entry.sessionId)).toEqual([OPEN])
  })

  it('removes a session from the OmniTerm list without touching agent files', async () => {
    setup()
    await screen.findAllByTestId('session-cleanup-row')
    fireEvent.click(screen.getByLabelText('Select Remembered'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove from List…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(loadStoredSessions().map((entry) => entry.sessionId)).toEqual([OPEN]))
    expect(invokeMock).not.toHaveBeenCalledWith('agent_session_files_delete', expect.anything())
  })

  it('reports a listing failure and still shows the remembered sessions', async () => {
    invokeMock.mockRejectedValue(new Error('denied'))
    setup()
    expect(await screen.findByText(/Could not read the agent sessions/)).toBeTruthy()
    expect(screen.getAllByTestId('session-cleanup-row')).toHaveLength(2)
  })
})
