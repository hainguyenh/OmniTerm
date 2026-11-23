/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const slots = vi.hoisted(() => ({ items: [] as Array<{ slot: string; action: string; icon?: string }>, disposed: 0 }))
vi.mock('../../ide/workbench/contributions', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  registerMenuSlotItem: vi.fn((slot: string, item: { action: string; icon?: string }) => {
    slots.items.push({ slot, ...item })
    return () => {
      slots.disposed += 1
    }
  }),
}))

const invoke = vi.hoisted(() => vi.fn(async (..._args: unknown[]): Promise<unknown> => null))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { getAction } from '../../ide/platform/actions'
import { evaluateWhen, getContext } from '../../ide/platform/context'
import { useWorkbenchSlots } from '../../ide/workbench/contributions'
import { omnitermActionId } from '../../platform/omnitermActions'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { resetPanePresenceForTests, setPanePresence } from '../../utils/agentPresenceStore'
import { glyphGrid } from '../layout/layoutGlyphs'
import { LayoutPresetPicker } from '../layout/LayoutPresetPicker'
import { applyEditorPreset, maximizeActivePane, restoreMaximized } from '../layout/layoutPresetStore'
import { PANE_MAXIMIZED, registerPaneTitleActions, TOGGLE_MAXIMIZE_PANE } from '../layout/paneTitleActions'
import { resetQuotaStore, updateQuota } from '../../features/agent-quota/quotaStore'
import { clearStoredSessions, upsertSession } from '../../utils/agentSessionStorage'
import { clearPaneConsole, registerPaneConsole } from '../../utils/paneConsoles'
import { SessionAgentFooter, SessionAgentHeader } from '../sessions/SessionAgentHeader'
import { useSessionBridge } from '../sessions/sessionBridge'
import { EmptyPaneLauncher } from '../sessions/EmptyPaneLauncher'
import { NEW_SESSION_IN_PANE } from '../sessions/paneQuickStartStore'
import { paintOnGroup } from '../sessions/sessionIcons'

afterEach(() => {
  cleanup()
  resetPanePresenceForTests()
  resetQuotaStore()
  useSessionBridge.setState({ sessions: [] })
})

describe('pane title actions', () => {
  it('adds Maximize to the editor actions, New Session to every pane tab strip, the session launcher to the empty pane, and removes them again', () => {
    const dispose = registerPaneTitleActions()
    expect(slots.items).toEqual([
      expect.objectContaining({ slot: 'editor.title', action: TOGGLE_MAXIMIZE_PANE, icon: 'fullscreen', when: `!${PANE_MAXIMIZED}` }),
      expect.objectContaining({ slot: 'editor.title', action: TOGGLE_MAXIMIZE_PANE, icon: 'fullscreen-exit', when: PANE_MAXIMIZED }),
      expect.objectContaining({ slot: 'editor.pane', action: omnitermActionId('newSession'), icon: 'plus' }),
    ])
    expect(getAction(NEW_SESSION_IN_PANE)).toBeDefined()
    expect(useWorkbenchSlots.getState().emptyPane).toBe(EmptyPaneLauncher)
    dispose()
    expect(slots.disposed).toBe(3)
    expect(getAction(NEW_SESSION_IN_PANE)).toBeUndefined()
    expect(useWorkbenchSlots.getState().emptyPane).toBeUndefined()
  })
})

describe('the maximize button', () => {
  it('turns into Restore while a pane is maximized', () => {
    const dispose = registerPaneTitleActions()
    expect(getContext()[PANE_MAXIMIZED]).toBe(false)
    expect(applyEditorPreset('2')).toBe(true)
    act(() => {
      maximizeActivePane()
    })
    expect(getContext()[PANE_MAXIMIZED]).toBe(true)
    expect(evaluateWhen(PANE_MAXIMIZED)).toBe(true)
    expect(evaluateWhen(`!${PANE_MAXIMIZED}`)).toBe(false)
    act(() => {
      restoreMaximized()
    })
    expect(getContext()[PANE_MAXIMIZED]).toBe(false)
    dispose()
    expect(getContext()[PANE_MAXIMIZED]).toBeUndefined()
  })
})

describe('layout preset picker', () => {
  it('draws each preset glyph as a grid with one cell per pane', () => {
    expect(glyphGrid('1+2')).toEqual({
      gridTemplateAreas: "'p0 p1' 'p0 p2'",
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
      cells: ['p0', 'p1', 'p2'],
    })
    expect(glyphGrid('4x2').cells).toHaveLength(8)
    expect(glyphGrid('2h').gridTemplateRows).toBe('repeat(2, minmax(0, 1fr))')
  })

  it('opens the presets as a glyph grid with the current one checked, and picks one', async () => {
    const onSelect = vi.fn()
    render(<LayoutPresetPicker current="2" onSelect={onSelect} />)
    const button = screen.getByRole('button', { name: 'Pane layout: 2 columns' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    const options = await screen.findAllByRole('menuitemradio')
    expect(options.map((option) => option.textContent)).toEqual(['1 pane', '2 columns', '1 + 2', '2 × 2', '3 × 2', '4 × 2', '2 rows'])
    expect(options.filter((option) => option.getAttribute('aria-checked') === 'true').map((option) => option.textContent)).toEqual(['2 columns'])
    expect(screen.getByRole('menuitemradio', { name: '2 × 2' }).getAttribute('aria-keyshortcuts')).toBe('Control+4')
    act(() => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: '2 × 2' }))
    })
    expect(onSelect).toHaveBeenCalledWith('2x2')
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('names a hand-split layout as custom', () => {
    render(<LayoutPresetPicker current="custom" onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Pane layout: Custom layout' })).toBeTruthy()
    expect(screen.getByTestId('layout-preset-picker').dataset.layoutPreset).toBe('custom')
  })
})

describe('session agent header', () => {
  const presence = { agent: 'claude' as const, profileName: 'claude', pid: 1, startTime: 0 }

  it('shows nothing for a plain terminal', () => {
    const { container } = render(<SessionAgentHeader sessionId="t1" />)
    expect(container.firstChild).toBeNull()
  })

  // Regression: the header showed the terminal's name (the shell's window title) instead of
  // what the agent works on.
  it('shows the project the agent works in, not the terminal name or the profile', () => {
    act(() => {
      setPanePresence({ t1: { ...presence, profileName: 'claude-work' } })
      useSessionBridge.setState({ sessions: [{ id: 't1', connId: 't1', name: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', connType: 'LOCAL', workspaceId: null, status: 'connected', busy: false, cwd: 'D:/work/omniterm', hasCommand: false }] })
    })
    const { container } = render(<SessionAgentHeader sessionId="t1" />)
    expect(container.textContent).toBe('omniterm')
    expect(container.querySelector('[data-session-agent-header="claude"]')).not.toBeNull()
  })

  it('names the project after the session workspace when it has one', () => {
    act(() => {
      setPanePresence({ t1: presence })
      useWorkspaceStore.setState({ workspaces: [{ id: 'w1', name: 'Billing', folders: [], order: 0, pins: [] }] })
      useSessionBridge.setState({ sessions: [{ id: 't1', connId: 't1', name: 'pwsh', connType: 'LOCAL', workspaceId: 'w1', status: 'connected', busy: false, cwd: 'D:/work/omniterm', hasCommand: false }] })
    })
    const { container } = render(<SessionAgentHeader sessionId="t1" />)
    expect(container.textContent).toBe('Billing')
    act(() => useWorkspaceStore.setState({ workspaces: [] }))
  })

  it('prefers the title of the agent conversation over the project', () => {
    act(() => {
      setPanePresence({ t1: presence })
      useSessionBridge.setState({ sessions: [{ id: 't1', connId: 't1', name: 'pwsh', connType: 'LOCAL', workspaceId: null, status: 'connected', busy: false, cwd: 'D:/work', hasCommand: false }] })
    })
    const { container } = render(<SessionAgentHeader sessionId="t1" />)
    expect(container.textContent).toBe('work')
    act(() => upsertSession({ id: 'claude:11111111-1111-4111-8111-111111111111', agent: 'claude', profileName: 'claude', sessionId: '11111111-1111-4111-8111-111111111111', tabId: 't1', title: 'Fix the login bug', state: 'active', updatedAt: Date.now() }))
    expect(container.textContent).toBe('Fix the login bug')
    act(() => clearStoredSessions())
  })

  it('duplicates the agent from beside the title through the session bridge', () => {
    const duplicateAgent = vi.fn()
    act(() => {
      setPanePresence({ t1: presence })
      useSessionBridge.setState({ api: { killSession: vi.fn(), newSessionLike: vi.fn(), reconnect: vi.fn(), skipConfirm: () => false, setSkipConfirm: vi.fn(), duplicateAgent } })
    })
    render(<SessionAgentHeader sessionId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: /^Duplicate/ }))
    expect(duplicateAgent).toHaveBeenCalledWith('t1')
    act(() => useSessionBridge.setState({ api: null }))
  })

  // Regression: the UI revamp dropped the old pane header, and with it the only place the Agent
  // Quota loading artwork was drawn.
  it('shows the pace artwork while the agent works, and nothing while it is idle', () => {
    const session = { id: 't1', connId: 't1', name: 'pwsh', connType: 'LOCAL', workspaceId: null, status: 'connected' as const, cwd: 'D:/work', hasCommand: false }
    act(() => {
      setPanePresence({ t1: presence })
      useSessionBridge.setState({ sessions: [{ ...session, busy: false }] })
    })
    const { container } = render(<SessionAgentHeader sessionId="t1" />)
    const zone = screen.getByTestId('agent-activity-zone')
    expect(zone.querySelector('.aq-busy-art')).toBeNull()
    act(() => useSessionBridge.setState({ sessions: [{ ...session, busy: true }] }))
    const art = container.querySelector('.aq-busy-art')
    expect(art).not.toBeNull()
    expect(art?.getAttribute('data-loading-tier')).toBe('onTrack')
    expect(art?.querySelector('img')).not.toBeNull()
    // The zone stops at 80% of the header, so the art cannot run past it.
    expect(zone.className).toContain('mr-[20%]')
  })
})

describe('session agent footer', () => {
  const presence = { agent: 'claude' as const, profileName: 'claude', pid: 1, startTime: 0 }

  it('shows nothing for a plain terminal', () => {
    const { container } = render(<SessionAgentFooter sessionId="t2" />)
    expect(container.firstChild).toBeNull()
  })

  // Attach file and the quota moved from the header to the pane footer, beside the font size controls.
  it('offers Attach file and shows the quota as bars once read', () => {
    act(() => setPanePresence({ t1: presence }))
    render(<SessionAgentFooter sessionId="t1" />)
    expect(screen.queryByTestId('agent-footer-meters')).toBeNull()
    expect(screen.getByRole('button', { name: 'Attachments' }).closest('[role=toolbar]')?.getAttribute('aria-label')).toBe('Agent actions')
    act(() => {
      updateQuota((state) => ({
        ...state,
        config: { ...state.config, enabled: true },
        terminals: { t1: { sessionId: 't1', agent: 'claude', pid: 1, startTime: 0, profileDir: null, profileName: 'claude', subAgentCount: 0, launcher: null, instanceKey: 'i1', profileKey: 'claude:default' } },
        profiles: {
          'claude:default': {
            key: 'claude:default', agent: 'claude', profileName: 'claude', profileDir: null, launcher: null, history: [], errorStreak: 0,
            nextFetchAt: 0, fetching: false, wake: {}, waking: false,
            lastGood: { fetchedAt: 0, windows: [{ kind: 'session', label: '5h', usedPct: 63.6 }, { kind: 'weekly', label: 'wk', usedPct: 12 }] },
          },
        },
      }))
    })
    expect(screen.getByTestId('agent-footer-meter-session').textContent).toBe('5h64%')
    expect(screen.getByTestId('agent-footer-meter-weekly').textContent).toBe('wk12%')
    expect(screen.getAllByRole('meter').map((meter) => meter.getAttribute('aria-valuenow'))).toEqual(['64', '12'])
  })

  // Regression: the footer floated over the terminal and covered the agent's last line.
  it('is a row of its own, never laid over the terminal', () => {
    act(() => setPanePresence({ t1: presence }))
    render(<SessionAgentFooter sessionId="t1" />)
    const footer = screen.getByTestId('agent-footer')
    expect(footer.hasAttribute('data-agent-footer')).toBe(true)
    expect(footer.className).not.toMatch(/\babsolute\b/)
    expect(screen.getByTestId('agent-footer-actions').className).not.toMatch(/\babsolute\b/)
  })

  const conversation = '11111111-1111-4111-8111-111111111111'
  const withQuota = (profileDir: string | null) => updateQuota((state) => ({
    ...state,
    config: { ...state.config, enabled: true },
    terminals: { t1: { sessionId: 't1', agent: 'claude', pid: 1, startTime: 0, profileDir, profileName: 'claude', subAgentCount: 0, launcher: null, instanceKey: 'i1', profileKey: 'claude:default' } },
    profiles: {
      'claude:default': {
        key: 'claude:default', agent: 'claude', profileName: 'claude', profileDir, launcher: null, history: [], errorStreak: 0,
        nextFetchAt: 0, fetching: false, wake: {}, waking: false,
        lastGood: { fetchedAt: 0, windows: [{ kind: 'session', label: '5h', usedPct: 12 }] },
      },
    },
  }))

  it('draws the quota and the context as bars and keeps the status line text for the tooltip', async () => {
    invoke.mockResolvedValue({ text: '\x1b[32mOpus 4\x1b[0m  ~/work\n\x1b]8;;https://x\x075h 4%\x1b]8;;\x07\n', contextPct: 41.6 })
    act(() => {
      setPanePresence({ t1: { ...presence, claudeSessionId: conversation } })
      withQuota('C:/Users/me/.claude')
    })
    render(<SessionAgentFooter sessionId="t1" />)
    const context = await screen.findByTestId('agent-footer-meter-context')
    expect(context.textContent).toBe('ctx42%')
    expect(screen.getByTestId('agent-footer-meter-session').textContent).toBe('5h12%')
    expect(screen.getByTestId('agent-footer-meters').getAttribute('title')).toBe('Opus 4 ~/work · 5h 4%')
    expect(screen.queryByTestId('agent-footer-statusline')).toBeNull()
    expect(invoke).toHaveBeenCalledWith('agent_quota_statusline_text', { profileDir: 'C:/Users/me/.claude', sessionId: conversation })
    invoke.mockReset()
    invoke.mockResolvedValue(null)
  })

  it('shows the status line as one plain row while there is no bar to draw', async () => {
    invoke.mockResolvedValue({ text: 'Opus 4 · main', contextPct: null })
    act(() => {
      setPanePresence({ t1: { ...presence, claudeSessionId: conversation } })
      updateQuota((state) => ({
        ...state,
        config: { ...state.config, enabled: true },
        terminals: { t1: { sessionId: 't1', agent: 'claude', pid: 1, startTime: 0, profileDir: 'C:/p', profileName: 'claude', subAgentCount: 0, launcher: null, instanceKey: 'i1', profileKey: 'claude:default' } },
      }))
    })
    render(<SessionAgentFooter sessionId="t1" />)
    const line = await screen.findByTestId('agent-footer-statusline')
    expect(line.textContent).toBe('Opus 4 · main')
    expect(screen.queryByTestId('agent-footer-meters')).toBeNull()
    invoke.mockReset()
    invoke.mockResolvedValue(null)
  })

  it('keeps the quota while the agent has no status line, or its conversation is not known', async () => {
    invoke.mockResolvedValue(null)
    act(() => {
      setPanePresence({ t1: { ...presence, claudeSessionId: conversation } })
      withQuota('C:/Users/me/.claude')
    })
    render(<SessionAgentFooter sessionId="t1" />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(invoke).toHaveBeenCalled()
    expect(screen.queryByTestId('agent-footer-statusline')).toBeNull()
    expect(screen.queryByTestId('agent-footer-meter-context')).toBeNull()
    expect(screen.getByTestId('agent-footer-meter-session').textContent).toBe('5h12%')

    invoke.mockClear()
    act(() => setPanePresence({ t1: presence }))
    expect(invoke).not.toHaveBeenCalled()
    expect(screen.getByTestId('agent-footer-meter-session').textContent).toBe('5h12%')
  })

  it('exports, clears and renews the console from beside the attachments list', () => {
    act(() => setPanePresence({ t1: presence }))
    const events: { type: string; detail: unknown }[] = []
    const record = (event: Event) => events.push({ type: event.type, detail: (event as CustomEvent).detail })
    window.addEventListener('omniterm:save-terminal-output', record)
    window.addEventListener('omniterm:renew-session', record)
    const term = { clear: vi.fn() }
    const registration = registerPaneConsole('t1', term)
    try {
      render(<SessionAgentFooter sessionId="t1" />)
      const toolbar = screen.getByRole('toolbar', { name: 'Agent actions' })
      const labels = Array.from(toolbar.querySelectorAll('button')).map((button) => button.getAttribute('aria-label') ?? button.title)
      expect(labels.map((label) => label.split(' ')[0])).toEqual(['Attachments', 'Export', 'Clear', 'Renew'])

      fireEvent.click(screen.getByRole('button', { name: /^Export the whole console/ }))
      fireEvent.click(screen.getByRole('button', { name: /^Clear the console/ }))
      fireEvent.click(screen.getByRole('button', { name: /^Renew the console/ }))
      expect(events).toEqual([
        { type: 'omniterm:save-terminal-output', detail: { sessionId: 't1' } },
        { type: 'omniterm:renew-session', detail: 't1' },
      ])
      expect(term.clear).toHaveBeenCalledTimes(1)
    } finally {
      registration.dispose()
      window.removeEventListener('omniterm:save-terminal-output', record)
      window.removeEventListener('omniterm:renew-session', record)
    }
    expect(clearPaneConsole('t1')).toBe(false)
  })
})

describe('agent tab icons', () => {
  it('moves paint from the svg root onto a group, so the icon set keeps it', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1"/></svg>'
    expect(paintOnGroup(svg)).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1"/></g></svg>')
    expect(paintOnGroup('<svg viewBox="0 0 16 16"><path/></svg>')).toBe('<svg viewBox="0 0 16 16"><path/></svg>')
  })
})
