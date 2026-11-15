/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { initialTabsState, openTab, paneIds, splitPane } from '../../ide/editor/core/model/tabs'
import { EditorShownProvider } from '../../ide/workbench/contributions'
import { deriveGrid } from '../sessions/editorLayoutBridge'
import { markSessionRestoreSettled, resetSessionBridge, setLegacyLayout, useSessionBridge } from '../sessions/sessionBridge'
import { sessionCloseNeedsConfirm } from '../sessions/sessionBusy'
import { sessionInput } from '../sessions/sessionInput'
import { applyLegacyPlacement, planLegacyPlacement } from '../sessions/sessionMigration'
import { SessionTab } from '../sessions/SessionTab'
import { SessionTabStatus } from '../sessions/SessionTabStatus'
import { resetSurfaces, surfaceHost } from '../sessions/surfaceRegistry'

afterEach(() => {
  cleanup()
  resetSurfaces()
  resetSessionBridge()
})

describe('sessionCloseNeedsConfirm', () => {
  it('asks for connecting and busy sessions only', () => {
    expect(sessionCloseNeedsConfirm('connecting', 'LOCAL', undefined)).toBe(true)
    expect(sessionCloseNeedsConfirm('connected', 'LOCAL', true)).toBe(true)
    expect(sessionCloseNeedsConfirm('connected', 'LOCAL', undefined)).toBe(true)
    expect(sessionCloseNeedsConfirm('connected', 'SSH', false)).toBe(true)
    expect(sessionCloseNeedsConfirm('connected', 'LOCAL', false)).toBe(false)
    expect(sessionCloseNeedsConfirm('closed', 'LOCAL', true)).toBe(false)
    expect(sessionCloseNeedsConfirm('error', 'LOCAL', true)).toBe(false)
    expect(sessionCloseNeedsConfirm(undefined, 'LOCAL', true)).toBe(false)
  })
})

describe('legacy grid migration', () => {
  const layout = (panes: (string | null)[], focusedPane = 0) => ({
    layoutMode: 4,
    panes: [...panes, ...Array(8).fill(null)].slice(0, 8),
    focusedPane,
  })

  it('keeps the grid slots, maps layoutMode to a preset and ignores sessions that are not live', () => {
    const plan = planLegacyPlacement(layout(['a', null, 'dead', 'b'], 3), new Set(['a', 'b']))
    expect(plan).toEqual({
      preset: '2x2',
      assignments: [{ sessionId: 'a', pane: 0 }, { sessionId: 'b', pane: 3 }],
      focusedPane: 3,
    })
    expect(planLegacyPlacement(layout([null, null]), new Set(['a']))).toBeNull()
  })

  it('builds the preset of the grid, each session in its pane and the rest empty', () => {
    const plan = planLegacyPlacement(layout(['a', 'b', 'c'], 1), new Set(['a', 'b', 'c']))!
    const next = applyLegacyPlacement(initialTabsState(), plan)!
    const panes = paneIds(next)
    expect(panes).toHaveLength(4)
    expect(panes.map((id) => next.panes[id]!.tabs.map((tab) => tab.input.key))).toEqual([['session:a'], ['session:b'], ['session:c'], []])
    expect(next.activePane).toBe(panes[1])
  })

  it('leaves an editor that already has tabs alone', () => {
    const state = initialTabsState()
    const withTab = openTab(state, state.activePane, { kind: 'file', key: 'f' }).state
    expect(applyLegacyPlacement(withTab, { preset: '1', assignments: [], focusedPane: 0 })).toBeNull()
  })
})

describe('deriveGrid', () => {
  it('maps editor panes to the legacy grid so snapshots stay readable', () => {
    let state = initialTabsState()
    state = openTab(state, state.activePane, sessionInput('a')).state
    state = openTab(state, state.activePane, sessionInput('b')).state
    const split = splitPane(state, state.activePane, 'row')
    const grid = deriveGrid(split.state)
    expect(grid.layoutMode).toBe(2)
    expect(grid.panes.slice(0, 3)).toEqual(['b', 'b', null])
    expect(grid.focusedPane).toBe(1)
  })

  it('shows a pane without a session tab as empty, and rounds the pane count up to a layout mode', () => {
    let state = initialTabsState()
    for (let index = 0; index < 4; index++) state = splitPane(state, state.activePane, 'row').state
    expect(paneIds(state)).toHaveLength(5)
    expect(deriveGrid(state)).toMatchObject({ layoutMode: 5, panes: Array(8).fill(null) })
  })
})

describe('session bridge restore signal', () => {
  it('is requested once and keeps the saved grid until consumed', () => {
    markSessionRestoreSettled()
    markSessionRestoreSettled()
    expect(useSessionBridge.getState().restoreRequested).toBe(true)
    expect(useSessionBridge.getState().restoreSettled).toBe(false)
    setLegacyLayout({ layoutMode: 2, panes: ['a'], focusedPane: 0 })
    expect(useSessionBridge.getState().legacyLayout?.layoutMode).toBe(2)
    setLegacyLayout(null)
    expect(useSessionBridge.getState().legacyLayout).toBeNull()
  })
})

describe('SessionTab', () => {
  it('lends its box to the session surface and says when the session is not in this window', () => {
    const view = render(
      <EditorShownProvider value>
        <SessionTab input={sessionInput('gone')} />
      </EditorShownProvider>,
    )
    expect(screen.getByRole('status').textContent).toMatch(/not running in this window/)
    const host = surfaceHost('gone')
    expect(view.container.querySelector('[data-session-tab="gone"]')?.contains(host)).toBe(true)
    act(() => useSessionBridge.setState({ sessions: [{ id: 'gone', connId: 'gone', name: 'x', connType: 'LOCAL', workspaceId: null, status: 'connected', busy: false, cwd: null, hasCommand: false }] }))
    expect(screen.queryByRole('status')).toBeNull()
    view.unmount()
    expect(host.parentElement?.dataset.sessionParking).toBeDefined()
  })

  it('renders nothing session-specific for an invalid input', () => {
    const { container } = render(<SessionTab input={{ kind: 'omniterm.session', key: 'bad' }} />)
    expect(container.querySelector('[data-session-tab]')).toBeNull()
  })
})

describe('SessionTabStatus', () => {
  const base = { connId: 'a', name: 'a', connType: 'LOCAL', workspaceId: null, cwd: null, hasCommand: false }
  it('marks connecting, busy and exited sessions; an idle one has no marker', () => {
    const show = (status: 'connecting' | 'connected' | 'closed', busy: boolean | undefined) => {
      useSessionBridge.setState({ sessions: [{ ...base, id: 'a', status, busy }] })
      return render(<SessionTabStatus sessionId="a" />)
    }
    expect(show('connecting', undefined).container.querySelector('[data-session-status="connecting"]')).not.toBeNull()
    cleanup()
    expect(show('connected', true).container.querySelector('[data-session-status="busy"]')).not.toBeNull()
    cleanup()
    expect(show('closed', false).container.querySelector('[data-session-status="closed"]')).not.toBeNull()
    cleanup()
    expect(show('connected', false).container.firstChild).toBeNull()
    cleanup()
    expect(render(<SessionTabStatus sessionId="other" />).container.firstChild).toBeNull()
  })
})
