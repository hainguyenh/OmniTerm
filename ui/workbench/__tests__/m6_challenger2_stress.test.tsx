/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState, type ReactNode } from 'react'

const executedActions: string[] = []

// jsdom has no ResizeObserver; the footer chips measure the editor's edge with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
const openInput = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const activate = vi.hoisted(() => vi.fn())

// Keeping the Sessions tab open reads the editor's tabs; the real controller pulls in every
// editor contribution.
vi.mock('../../ide/editor/core/controller', async () => {
  const { create } = await import('zustand')
  const { initialTabsState } = await import('../../ide/editor/core/model/tabs')
  return { useTabs: create(() => initialTabsState()), editorController: () => ({}) }
})
vi.mock('../sessions/sessionTabsReconciler', () => ({ startSessionTabsReconciler: () => () => {} }))
vi.mock('../activateWorkbenchFeatures', () => ({
  activateWorkbenchFeatures: activate,
  WORKBENCH_STEPS: [],
  DEFERRED_WORKBENCH_STEPS: [],
}))

vi.mock('../../ide/platform/actions', () => ({
  executeAction: vi.fn((actName: string) => {
    executedActions.push(actName)
    return Promise.resolve()
  }),
}))


let currentEditorView: 'sessions' | 'file1' | 'preview_md' | 'preview_csv' = 'sessions'

vi.mock('../../ide/workbench/TitleBar', () => ({
  TitleBar: () => <div data-testid="title-bar" />,
}))
vi.mock('../../ide/workbench/StatusBar', () => ({
  StatusBar: () => <div data-testid="status-bar" />,
}))
vi.mock('../../ide/workbench/OverlayHost', () => ({
  OverlayHost: () => null,
}))
vi.mock('../../ide/workbench/EditorArea', () => {
  return {
    EditorArea: () => (
      <div data-testid="editor-area">
        {currentEditorView === 'sessions' && <div data-testid="sessions-view" />}
        {currentEditorView === 'file1' && <div data-testid="cm6-editor">CodeMirror Editor Active</div>}
        {currentEditorView === 'preview_md' && <div data-testid="markdown-preview">Markdown Preview Active</div>}
        {currentEditorView === 'preview_csv' && <div data-testid="csv-preview">CSV Preview Active</div>}
      </div>
    ),
  }
})

vi.mock('../../ide/workbench/toolwindows/ToolWindows', () => ({
  ToolWindowLayout: ({ editor }: { editor: ReactNode }) => (
    <div data-testid="tool-windows-layout">{editor}</div>
  ),
}))

vi.mock('../../ide/workbench/contributions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ide/workbench/contributions')>()),
  editorService: () => ({ openInput }),
  registerEditorKind: vi.fn(() => () => {}),
  registerStatusItem: vi.fn(() => () => {}),
}))

import { SessionLayoutControls } from '../layout/SessionLayoutControls'
import type { ZoomModel } from '../layout/useLayoutPreset'
import {
  initialQuotaState,
  updateQuota,
} from '../../features/agent-quota/quotaStore'
import { QuotaStripVertical } from '../QuotaStripVertical'
import { useQuotaPopup } from '../quota/quotaDockState'
import { StatusBarQuotaChips } from '../StatusBarQuotaChips'
import { StripePortal } from '../StripePortal'
import { usePreviewModeStore, type PreviewMode } from '../previews/previewKinds'
import { WorkbenchFrame } from '../WorkbenchFrame'

function StatefulTerminalTerminal({
  onMount,
  onUnmount,
}: {
  onMount?: () => void
  onUnmount?: () => void
}) {
  const [ptyBuffer, setPtyBuffer] = useState('initial-pty-output')
  useEffect(() => {
    onMount?.()
    return () => {
      onUnmount?.()
    }
  }, [onMount, onUnmount])
  return (
    <div data-testid="pty-terminal-instance">
      <input
        data-testid="pty-input"
        value={ptyBuffer}
        onChange={(e) => setPtyBuffer(e.target.value)}
      />
    </div>
  )
}

describe('Milestone UI-RESTORE: Challenger 2 Empirical Stress Verification', () => {
  let releaseSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    executedActions.length = 0
    currentEditorView = 'sessions'
    releaseSpy = vi.fn()
    activate.mockReset()
    activate.mockImplementation(() => releaseSpy)
    openInput.mockReset()
    openInput.mockResolvedValue(undefined)
    usePreviewModeStore.setState({ modes: {} })

    // Reset quota store
    updateQuota(() => initialQuotaState())
    useQuotaPopup.setState({ open: false })

    // Mock window.omnitermAPI
    window.omnitermAPI = {
      workspace: {
        list: vi.fn().mockResolvedValue([
          {
            id: 'ws-main',
            name: 'Workspace 1',
            folders: [{ path: 'D:/workspace/OmniTerm' }],
          },
        ]),
      },
      settings: {
        save: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as typeof window.omnitermAPI
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  describe('1. Terminal DOM Persistence Under Rapid Interleaved Transitions', () => {
    it('preserves single host DOM identity, zero unmounts, and intact PTY buffer across 50 rapid interleaved cycles', () => {
      const mountSpy = vi.fn()
      const unmountSpy = vi.fn()

      const { rerender } = render(
        <WorkbenchFrame>
          <StatefulTerminalTerminal onMount={mountSpy} onUnmount={unmountSpy} />
        </WorkbenchFrame>,
      )

      expect(mountSpy).toHaveBeenCalledTimes(1)
      expect(unmountSpy).toHaveBeenCalledTimes(0)

      const initialHostNode = document.querySelector('[data-sessions-host]')
      expect(initialHostNode).toBeTruthy()
      expect(document.querySelectorAll('[data-sessions-host]')).toHaveLength(1)

      // Enter user text into mock PTY session
      const input = screen.getByTestId('pty-input') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'top -b -n 1; echo pty_healthy' } })
      expect(input.value).toBe('top -b -n 1; echo pty_healthy')

      // Interleave 50 transitions of what the editor area shows (a session tab, a file, two previews):
      // the shell's host stays attached in its dialogs slot and the terminal inside it is never rebuilt.
      const views: Array<'sessions' | 'file1' | 'preview_md' | 'preview_csv'> = [
        'sessions',
        'file1',
        'preview_md',
        'preview_csv',
      ]

      for (let i = 0; i < 50; i += 1) {
        currentEditorView = views[i % views.length]

        act(() => {
          rerender(
            <WorkbenchFrame>
              <StatefulTerminalTerminal onMount={mountSpy} onUnmount={unmountSpy} />
            </WorkbenchFrame>,
          )
        })

        // 1. Host DOM node remains the exact same instance, attached to the document
        expect(document.querySelector('[data-sessions-host]')).toBe(initialHostNode)

        // 2. Terminal instance never unmounted or remounted across any transition
        expect(mountSpy).toHaveBeenCalledTimes(1)
        expect(unmountSpy).toHaveBeenCalledTimes(0)

        // 3. User typed buffer remained 100% intact
        const currentInput = initialHostNode?.querySelector('[data-testid="pty-input"]') as HTMLInputElement
        expect(currentInput).toBeTruthy()
        expect(currentInput.value).toBe('top -b -n 1; echo pty_healthy')
      }
    })
  })

  describe('2. Editor Area & Previews Switching Stress Test', () => {
    it('rapidly cycles between editor modes (code/split/preview) and preview kinds without desync or throw', () => {
      const files = [
        { uri: 'file:///workspace/readme.md', kind: 'markdown' },
        { uri: 'file:///workspace/data.csv', kind: 'csv' },
        { uri: 'file:///workspace/graph.json', kind: 'json-graph' },
        { uri: 'file:///workspace/page.html', kind: 'html' },
        { uri: 'file:///workspace/vector.svg', kind: 'svg' },
      ]

      const modes: PreviewMode[] = ['code', 'split', 'preview']

      // Rapidly assign and transition preview modes
      for (let cycle = 0; cycle < 30; cycle += 1) {
        for (const file of files) {
          const modeChoice = modes[cycle % modes.length]
          act(() => {
            usePreviewModeStore.getState().setMode(file.uri, modeChoice)
          })
          expect(usePreviewModeStore.getState().modes[file.uri]).toBe(modeChoice)
        }
      }

      // Verify all modes are recorded correctly
      const state = usePreviewModeStore.getState().modes
      expect(Object.keys(state)).toHaveLength(files.length)
    })
  })

  describe('3. Status Bar & Right Stripe Reactivity Stress Test', () => {
    it('reactively updates Quota chips when quota store updates', () => {
      const { rerender } = render(<StatusBarQuotaChips />)

      // Initially no chips rendered because available is false
      expect(screen.queryByTestId('status-bar-quota-chips')).toBeNull()

      // Enable quota store with active profiles and terminals
      act(() => {
        updateQuota((s) => ({
          ...s,
          available: true,
          config: { ...s.config, enabled: true, dock: 'footer' },
          terminals: {
            'term-1': {
              sessionId: 's1',
              agent: 'claude',
              pid: 101,
              startTime: 1000,
              profileDir: null,
              profileName: 'Claude 3.5',
              subAgentCount: 0,
              launcher: null,
              instanceKey: 's1:101:1000',
              profileKey: 'claude:default',
            },
            'term-2': {
              sessionId: 's2',
              agent: 'codex',
              pid: 102,
              startTime: 1000,
              profileDir: null,
              profileName: 'OpenAI Codex',
              subAgentCount: 0,
              launcher: null,
              instanceKey: 's2:102:1000',
              profileKey: 'codex:default',
            },
          },
          profiles: {
            'claude:default': {
              key: 'claude:default',
              agent: 'claude',
              profileName: 'Claude 3.5',
              profileDir: null,
              launcher: null,
              history: [],
              errorStreak: 0,
              nextFetchAt: 0,
              fetching: false,
              wake: {},
              waking: false,
              snapshot: {
                fetchedAt: Date.now(),
                windows: [{ kind: 'session', label: '5h', usedPct: 42, resetsAt: Date.now() + 3600000 }],
              },
            },
            'codex:default': {
              key: 'codex:default',
              agent: 'codex',
              profileName: 'OpenAI Codex',
              profileDir: null,
              launcher: null,
              history: [],
              errorStreak: 0,
              nextFetchAt: 0,
              fetching: false,
              wake: {},
              waking: false,
              snapshot: {
                fetchedAt: Date.now(),
                windows: [{ kind: 'session', label: '5h', usedPct: 88, resetsAt: Date.now() + 1800000 }],
              },
            },
          },
        }))
      })

      rerender(<StatusBarQuotaChips />)

      const footerChips = screen.getByTestId('status-bar-quota-chips')
      expect(footerChips).toBeTruthy()
      expect(footerChips.textContent).toContain('42%')
      expect(footerChips.textContent).toContain('88%')

      // Rapidly update percentages 20 times and verify reactivity
      for (let pct = 50; pct <= 70; pct += 1) {
        act(() => {
          updateQuota((s) => ({
            ...s,
            profiles: {
              ...s.profiles,
              'claude:default': {
                ...s.profiles['claude:default']!,
                snapshot: {
                  fetchedAt: Date.now(),
                  windows: [{ kind: 'session', label: '5h', usedPct: pct, resetsAt: Date.now() + 3600000 }],
                },
              },
            },
          }))
        })
        expect(screen.getByTestId('status-bar-quota-chips').textContent).toContain(`${pct}%`)
      }
    })

    it('reactively renders Right Stripe micro-bars, the terminal zoom and the layout picker in StripePortal', async () => {
      // Create right stripe host node in document body
      const rightStripe = document.createElement('div')
      rightStripe.dataset.stripeSide = 'right'
      document.body.appendChild(rightStripe)

      // Setup quota store for vertical strip
      act(() => {
        updateQuota((s) => ({
          ...s,
          available: true,
          config: { ...s.config, enabled: true, dock: 'stripR' },
          profiles: {
            'claude:default': {
              key: 'claude:default',
              agent: 'claude',
              profileName: 'Claude',
              profileDir: null,
              launcher: null,
              history: [],
              errorStreak: 0,
              nextFetchAt: 0,
              fetching: false,
              wake: {},
              waking: false,
              snapshot: {
                fetchedAt: Date.now(),
                windows: [{ kind: 'session', label: '5h', usedPct: 35, resetsAt: Date.now() + 3600000 }],
              },
            },
          },
        }))
      })

      const step = vi.fn()
      const zoom: ZoomModel = { key: '2x2', available: true, zoom: 0.85, manual: false, step, auto: vi.fn() }

      const { unmount } = render(
        <StripePortal side="right">
          <QuotaStripVertical side="right" />
          <SessionLayoutControls zoom={zoom} />
        </StripePortal>,
      )

      // Verify portal mounted children into rightStripe
      expect(rightStripe.querySelector('[data-stripe-bottom="right"]')).toBeTruthy()
      expect(screen.getByTestId('quota-strip-vertical')).toBeTruthy()
      expect(screen.getByTestId('pane-zoom')).toBeTruthy()

      // Clicking QuotaStripVertical opens the quota details popup
      expect(useQuotaPopup.getState().open).toBe(false)
      fireEvent.click(screen.getByTestId('quota-strip-vertical'))
      expect(useQuotaPopup.getState().open).toBe(true)

      // The terminal zoom steps up from where it is
      fireEvent.click(screen.getByLabelText('Zoom panes in'))
      expect(step).toHaveBeenCalledWith(1)

      // The layout picker is one button naming the current layout; it opens the presets
      expect(screen.getByTestId('layout-preset-picker').dataset.layoutPreset).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /^Pane layout:/ }))
      expect(await screen.findByText('2 columns')).toBeTruthy()
      // The open menu is portalled into the body, which afterEach clears: unmount first.
      unmount()
    })
  })
})
