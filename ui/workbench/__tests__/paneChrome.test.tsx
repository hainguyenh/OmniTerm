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

import { omnitermActionId } from '../../platform/omnitermActions'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import { resetPanePresenceForTests, setPanePresence } from '../../utils/agentPresenceStore'
import { glyphGrid } from '../layout/layoutGlyphs'
import { LayoutPresetPicker } from '../layout/LayoutPresetPicker'
import { registerPaneTitleActions, TOGGLE_MAXIMIZE_PANE } from '../layout/paneTitleActions'
import { resetQuotaStore, updateQuota } from '../../features/agent-quota/quotaStore'
import { clearStoredSessions, upsertSession } from '../../utils/agentSessionStorage'
import { SessionAgentFooter, SessionAgentHeader } from '../sessions/SessionAgentHeader'
import { useSessionBridge } from '../sessions/sessionBridge'
import { paintOnGroup } from '../sessions/sessionIcons'

afterEach(() => {
  cleanup()
  resetPanePresenceForTests()
  resetQuotaStore()
  useSessionBridge.setState({ sessions: [] })
})

describe('pane title actions', () => {
  it('adds Maximize to the editor actions, New Session to every pane tab strip and the empty pane, and removes them again', () => {
    const dispose = registerPaneTitleActions()
    expect(slots.items).toEqual([
      expect.objectContaining({ slot: 'editor.title', action: TOGGLE_MAXIMIZE_PANE, icon: 'fullscreen' }),
      expect.objectContaining({ slot: 'editor.pane', action: omnitermActionId('newSession'), icon: 'plus' }),
      expect.objectContaining({ slot: 'editor.emptyPane', action: omnitermActionId('newSession') }),
    ])
    dispose()
    expect(slots.disposed).toBe(3)
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
})

describe('session agent footer', () => {
  const presence = { agent: 'claude' as const, profileName: 'claude', pid: 1, startTime: 0 }

  it('shows nothing for a plain terminal', () => {
    const { container } = render(<SessionAgentFooter sessionId="t2" />)
    expect(container.firstChild).toBeNull()
  })

  // Attach file and the quota moved from the header to the pane footer, beside the font size controls.
  it('offers Attach file and shows the quota once read', () => {
    act(() => setPanePresence({ t1: presence }))
    render(<SessionAgentFooter sessionId="t1" />)
    expect(screen.queryByTestId('agent-footer-quota')).toBeNull()
    expect(screen.getByRole('button', { name: /^Attach files/ }).closest('[role=toolbar]')?.getAttribute('aria-label')).toBe('Agent actions')
    act(() => {
      updateQuota((state) => ({
        ...state,
        config: { ...state.config, enabled: true },
        terminals: { t1: { sessionId: 't1', agent: 'claude', pid: 1, startTime: 0, profileDir: null, profileName: 'claude', subAgentCount: 0, launcher: null, instanceKey: 'i1', profileKey: 'claude:default' } },
        profiles: {
          'claude:default': {
            key: 'claude:default', agent: 'claude', profileName: 'claude', profileDir: null, launcher: null, history: [], errorStreak: 0,
            nextFetchAt: 0, fetching: false, wake: {}, waking: false,
            lastGood: { fetchedAt: 0, windows: [{ kind: 'session', label: '5h', usedPct: 63.6 }] },
          },
        },
      }))
    })
    expect(screen.getByTestId('agent-footer-quota').textContent).toBe('quota 64%')
  })
})

describe('agent tab icons', () => {
  it('moves paint from the svg root onto a group, so the icon set keeps it', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1"/></svg>'
    expect(paintOnGroup(svg)).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1"/></g></svg>')
    expect(paintOnGroup('<svg viewBox="0 0 16 16"><path/></svg>')).toBe('<svg viewBox="0 0 16 16"><path/></svg>')
  })
})
