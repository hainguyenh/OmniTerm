/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
const listeners = new Map<string, (event: { payload: unknown }) => void>()
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (event: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(event, handler)
    return () => listeners.delete(event)
  },
}))

import { useTasks } from '../../../ide/workbench/tasks'
import { clearStoredSessions, loadStoredSessions, upsertSession } from '../../../utils/agentSessionStorage'
import { SessionCleanupOverlay } from '../SessionCleanupDialog'
import { useSessionCleanup } from '../sessionCleanupStore'

const OLD = '11111111-1111-4111-8111-111111111111'
const OPEN = '22222222-2222-4222-8222-222222222222'
const LISTED = '33333333-3333-4333-8333-333333333333'
const EMPTY = '44444444-4444-4444-8444-444444444444'
const DAY = 86_400_000

const listing = [
  { id: `claude:claude:${OLD}`, agent: 'claude', profile: 'claude', sessionId: OLD, cwd: 'D:/work/app', title: 'Old work', lastActive: Date.now() - 40 * DAY, size: 4096 },
  { id: `claude:claude-work:${OPEN}`, agent: 'claude', profile: 'claude-work', sessionId: OPEN, cwd: 'D:/work/site', title: 'Running now', lastActive: Date.now(), size: 1024 },
  { id: 'codex:codex:x', agent: 'codex', profile: 'codex', sessionId: 'x', cwd: null, title: 'Codex run', lastActive: Date.now() - DAY, size: 10 },
]

const profiles = [
  { agent: 'claude', profile: 'claude' },
  { agent: 'claude', profile: 'claude-work' },
  { agent: 'codex', profile: 'codex' },
]

function setup() {
  act(() => useSessionCleanup.getState().setOpen(true))
  return render(<SessionCleanupOverlay />)
}

/** Opens the dialog and scans every profile, as a user pressing Scan with the defaults does. */
async function scanAll() {
  setup()
  const scan = await screen.findByTestId('session-cleanup-scan')
  await waitFor(() => expect((scan as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(scan)
}

const listCalls = () => invokeMock.mock.calls.filter(([command]) => command === 'agent_session_files_list')

describe('SessionCleanupDialog', () => {
  beforeEach(() => {
    useSessionCleanup.setState({ open: false, files: null, scanned: [], scannedDays: 0, scanning: false, error: null, job: null, status: null })
    useTasks.setState({ tasks: [] })
    listeners.clear()
    localStorage.clear()
    clearStoredSessions()
    invokeMock.mockReset()
    invokeMock.mockImplementation(async (command: string, args?: { ids: string[] }) => {
      if (command === 'agent_session_profiles_list') return profiles
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

  it('reads nothing until Scan is pressed, then the profiles found on this machine', async () => {
    setup()
    expect(await screen.findByText(/press Scan to read 3 profiles/)).toBeTruthy()
    expect(listCalls()).toEqual([])
    expect(screen.queryAllByTestId('session-cleanup-row')).toEqual([])

    fireEvent.click(screen.getByTestId('session-cleanup-scan'))
    await waitFor(() => expect(listCalls()).toEqual([['agent_session_files_list', { profiles: ['claude', 'claude-work', 'codex'], olderThanDays: 0 }]]))
    expect(await screen.findAllByTestId('session-cleanup-row')).toHaveLength(4)
  })

  it('lists files and remembered sessions most recently active first; open sessions cannot be picked', async () => {
    await scanAll()
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
    await scanAll()
    await screen.findAllByTestId('session-cleanup-row')
    fireEvent.click(screen.getByLabelText('Select all'))
    expect(screen.getByTestId('session-cleanup-summary').textContent).toBe('3 selected · 4.0 KB')
    fireEvent.click(screen.getByRole('button', { name: /Delete…/ }))
    expect(screen.getByTestId('session-cleanup-status').textContent).toContain('Delete 3 sessions')
    expect(invokeMock).not.toHaveBeenCalledWith('agent_session_files_delete', expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Delete Permanently' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('agent_session_files_delete', { ids: ['codex:codex:x', `claude:claude:${OLD}`] }))
    await waitFor(() => expect(screen.getByTestId('session-cleanup-status').textContent).toContain('Deleted 3 sessions'))
    expect(loadStoredSessions().map((entry) => entry.sessionId)).toEqual([OPEN])
  })

  it('removes a session from the OmniTerm list without touching agent files', async () => {
    await scanAll()
    await screen.findAllByTestId('session-cleanup-row')
    fireEvent.click(screen.getByLabelText('Select Remembered'))
    fireEvent.click(screen.getByRole('button', { name: /Remove from List…/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(loadStoredSessions().map((entry) => entry.sessionId)).toEqual([OPEN]))
    expect(invokeMock).not.toHaveBeenCalledWith('agent_session_files_delete', expect.anything())
  })

  it('lists Gemini CLI and Antigravity sessions under their names', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'agent_session_profiles_list') return [{ agent: 'gemini', profile: 'gemini' }, { agent: 'agy', profile: 'antigravity-cli' }]
      if (command === 'agent_session_files_list') {
        return [
          { id: 'gemini:gemini:session-1', agent: 'gemini', profile: 'gemini', sessionId: 'session-1', cwd: 'D:/work/app', title: 'Explain', lastActive: Date.now() - DAY, size: 10 },
          { id: `agy:antigravity-cli:${OLD}`, agent: 'agy', profile: 'antigravity-cli', sessionId: OLD, cwd: null, title: null, lastActive: Date.now() - 2 * DAY, size: 20 },
        ]
      }
      throw new Error(command)
    })
    clearStoredSessions()
    await scanAll()
    const rows = await screen.findAllByTestId('session-cleanup-row')
    expect(rows.map((row) => row.querySelector('td:nth-child(2)')?.textContent)).toEqual(['Gemini CLI', 'Antigravity'])
  })

  it('deletes every selected session in one call with progress, runs on hidden, and updates the list without scanning again', async () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      id: `claude:claude:s${index}`,
      agent: 'claude',
      profile: 'claude',
      sessionId: `s${index}`,
      cwd: null,
      title: `Session ${index}`,
      lastActive: Date.now() - DAY - index,
      size: 1024,
    }))
    const calls: Array<{ ids: string[]; resolve: () => void }> = []
    invokeMock.mockImplementation((command: string, args?: { ids: string[] }) => {
      if (command === 'agent_session_profiles_list') return Promise.resolve(profiles)
      if (command === 'agent_session_files_list') return Promise.resolve(many)
      if (command === 'agent_session_files_delete') {
        const ids = args?.ids ?? []
        return new Promise((resolve) => calls.push({ ids, resolve: () => resolve({ deleted: ids, failed: [] }) }))
      }
      return Promise.reject(new Error(command))
    })
    clearStoredSessions()
    await scanAll()
    expect(await screen.findAllByTestId('session-cleanup-row')).toHaveLength(60)
    fireEvent.click(screen.getByLabelText('Select all'))
    expect(screen.getByTestId('session-cleanup-summary').textContent).toBe('60 selected · 60 KB')
    fireEvent.click(screen.getByRole('button', { name: /Delete…/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Permanently' }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]?.ids).toHaveLength(60)
    expect(screen.getByTestId('session-cleanup-status').textContent).toBe('Deleting: Starting…')
    expect((screen.getByTestId('session-cleanup-scan') as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => expect(listeners.has('session-cleanup:progress')).toBe(true))
    act(() => listeners.get('session-cleanup:progress')?.({ payload: { phase: 'delete', done: 25, total: 60, bytes: 25_600 } }))
    expect(screen.getByTestId('session-cleanup-status').textContent).toBe('Deleting: 25 of 60 sessions · 25 KB freed')
    expect(useTasks.getState().tasks).toEqual([expect.objectContaining({ id: 'omniterm.sessionCleanup', fraction: 25 / 60, done: false })])

    // Hiding the dialog leaves the delete running in the status bar.
    fireEvent.click(screen.getByRole('button', { name: 'Run in Background' }))
    expect(screen.queryByTestId('session-cleanup-dialog')).toBeNull()
    await act(async () => calls[0]?.resolve())
    await waitFor(() => expect(useSessionCleanup.getState().job).toBeNull())
    expect(useSessionCleanup.getState().status).toBe('Deleted 60 sessions.')
    expect(useSessionCleanup.getState().files).toEqual([])
    expect(listCalls()).toHaveLength(1)
  })

  it('cancels a running delete from the dialog', async () => {
    let finish: (report: unknown) => void = () => undefined
    invokeMock.mockImplementation((command: string) => {
      if (command === 'agent_session_profiles_list') return Promise.resolve(profiles)
      if (command === 'agent_session_files_list') return Promise.resolve(listing)
      if (command === 'agent_session_files_delete') return new Promise((resolve) => (finish = resolve))
      return Promise.resolve(undefined)
    })
    await scanAll()
    await screen.findAllByTestId('session-cleanup-row')
    fireEvent.click(screen.getByLabelText('Select Codex run'))
    fireEvent.click(screen.getByRole('button', { name: /Delete…/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Permanently' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(invokeMock).toHaveBeenCalledWith('agent_session_files_delete_cancel')
    expect(screen.getByTestId('session-cleanup-status').textContent).toBe('Cancelling…')
    await act(async () => finish({ deleted: [], failed: [['codex:codex:x', 'Cancelled']] }))
    await waitFor(() => expect(screen.getByTestId('session-cleanup-status').textContent).toBe('Deleted 0 sessions. Cancelled before 1 session.'))
  })

  it('names a session without a prompt "No conversation" and can show only those', async () => {
    const empty = { id: `claude:claude:${EMPTY}`, agent: 'claude', profile: 'claude', sessionId: EMPTY, cwd: null, title: null, lastActive: Date.now() - 50 * DAY, size: 187, empty: true }
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'agent_session_profiles_list') return profiles
      if (command === 'agent_session_files_list') return [...listing, empty]
      throw new Error(command)
    })
    await scanAll()
    expect(await screen.findByText('No conversation')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Empty only'))
    await waitFor(() => expect(screen.getAllByTestId('session-cleanup-row')).toHaveLength(1))
    expect(screen.getByText(EMPTY)).toBeTruthy()
  })

  it('reports a listing failure and still shows the remembered sessions', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'agent_session_profiles_list') return profiles
      throw new Error('denied')
    })
    await scanAll()
    expect(await screen.findByText(/Could not read the agent sessions/)).toBeTruthy()
    expect(screen.getAllByTestId('session-cleanup-row')).toHaveLength(2)
  })
})
