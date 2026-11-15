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
import { resetPanePresenceForTests, setPanePresence } from '../../utils/agentPresenceStore'
import { glyphGrid } from '../layout/layoutGlyphs'
import { LayoutPresetPicker } from '../layout/LayoutPresetPicker'
import { registerPaneTitleActions, TOGGLE_MAXIMIZE_PANE } from '../layout/paneTitleActions'
import { resetQuotaStore, updateQuota } from '../../../plugins/agent-quota/app/quotaStore'
import { SessionAgentBadge } from '../sessions/SessionAgentBadge'
import { SessionAgentHeader } from '../sessions/SessionAgentHeader'
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

describe('session agent badge', () => {
  it('shows while an AI agent runs in the session only', () => {
    const { container } = render(<SessionAgentBadge sessionId="t1" />)
    expect(container.textContent).toBe('')
    act(() => setPanePresence({ t1: { agent: 'claude', profileName: 'claude', pid: 1, startTime: 0 } }))
    expect(container.textContent).toBe('agent')
  })
})

describe('session agent header', () => {
  const presence = { agent: 'claude' as const, profileName: 'claude', pid: 1, startTime: 0 }

  it('shows nothing for a plain terminal', () => {
    const { container } = render(<SessionAgentHeader sessionId="t1" />)
    expect(container.firstChild).toBeNull()
  })

  it('names the agent, its folder and its quota, and offers Attach file', () => {
    act(() => {
      setPanePresence({ t1: presence })
      useSessionBridge.setState({ sessions: [{ id: 't1', connId: 't1', name: 'claude', connType: 'LOCAL', workspaceId: null, status: 'connected', busy: false, cwd: 'D:/work', hasCommand: false }] })
    })
    render(<SessionAgentHeader sessionId="t1" />)
    expect(screen.getByText('claude')).toBeTruthy()
    expect(screen.getByText('D:/work')).toBeTruthy()
    expect(screen.queryByTestId('agent-header-quota')).toBeNull()
    expect(screen.getByRole('button', { name: /Attach file/ })).toBeTruthy()
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
    expect(screen.getByTestId('agent-header-quota').textContent).toBe('quota 64%')
  })
})

describe('agent tab icons', () => {
  it('moves paint from the svg root onto a group, so the icon set keeps it', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1"/></svg>'
    expect(paintOnGroup(svg)).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1"/></g></svg>')
    expect(paintOnGroup('<svg viewBox="0 0 16 16"><path/></svg>')).toBe('<svg viewBox="0 0 16 16"><path/></svg>')
  })
})
