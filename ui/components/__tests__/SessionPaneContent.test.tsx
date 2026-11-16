/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SessionPaneContent } from '../SessionPaneContent'
import type { MainLayoutModel } from '../useMainLayoutController'

vi.mock('../TerminalView', () => ({
  default: ({ connection }: { connection: { name: string } }) => <div data-testid="terminal">{connection.name}</div>,
}))
vi.mock('../RDPView', () => ({ default: () => <div data-testid="rdp" /> }))
vi.mock('../ConnectingOverlay', () => ({ default: () => null }))
vi.mock('../PaneSessionOverlayHost', () => ({ PaneSessionOverlayHost: () => null }))
vi.mock('../../features/agent-quota/paneHosts', () => ({
  QuotaPaneLines: () => null,
  SuspendedOverlay: () => null,
  UsageProbeOverlay: () => null,
}))

function makeModel(connById: (id: string) => unknown): MainLayoutModel {
  return {
    appSettings: { themeId: 'a', fontSize: 14 },
    currentTheme: { id: 'a', terminal: { dark: {}, light: {} }, ui: { dark: {}, light: {} } },
    themes: [],
    connById,
    reconnectKeys: {},
    statuses: {},
    poppedOut: {},
    resumeMode: {},
    setStatus: vi.fn(),
  } as unknown as MainLayoutModel
}

const tab = { id: 't1', connId: 'c1', name: 'one' }

function renderPane(connById: (id: string) => unknown) {
  return render(
    <SessionPaneContent
      model={makeModel(connById)}
      tab={tab}
      active
      layoutEpoch="0"
      zoom={1}
      onNewSession={() => {}}
    />,
  )
}

describe('SessionPaneContent', () => {
  it('shows an unavailable notice instead of crashing when the connection is gone', () => {
    renderPane(() => undefined)

    expect(screen.queryByTestId('terminal')).toBeNull()
    expect(screen.getByText("This session's connection no longer exists.")).toBeTruthy()
  })

  it('mounts the terminal when the connection exists', () => {
    renderPane(() => ({ id: 'c1', name: 'prod', type: 'SSH' }))

    expect(screen.getByTestId('terminal').textContent).toBe('prod')
  })
})
