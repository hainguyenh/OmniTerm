/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const executedActions: string[] = []

// jsdom has no ResizeObserver; the footer chips measure the editor's edge with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
const registeredItems: Array<{ id: string; align: string; priority: number; component: () => unknown }> = []

vi.mock('../../ide/platform/actions', () => ({
  executeAction: vi.fn((act: string) => {
    executedActions.push(act)
    return Promise.resolve()
  }),
}))

vi.mock('../../ide/workbench/contributions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ide/workbench/contributions')>()),
  registerStatusItem: vi.fn((item: (typeof registeredItems)[0]) => {
    registeredItems.push(item)
    return () => {}
  }),
}))
// The session widget reads the editor's tabs; the real editor controller pulls in every contribution.
vi.mock('../StatusBarSessionWidget', () => ({ StatusBarSessionWidget: () => null }))



import { registerStatusBarWidgets } from '../registerStatusBarWidgets'
import { StatusBarQuotaChips } from '../StatusBarQuotaChips'
import { initialQuotaState, updateQuota } from '../../features/agent-quota/quotaStore'

describe('StatusBarWidgets', () => {
  beforeEach(() => {
    executedActions.length = 0
    registeredItems.length = 0
  })

  it('registers the quota chips and the session widget, not a second branch or bell', () => {
    const unregister = registerStatusBarWidgets()
    // The title bar names the branch and the right stripe holds Notifications, as in IDEA.
    expect(registeredItems.map((i) => i.id)).toEqual(['omniterm.quotaChips', 'omniterm.sessionInfo'])

    const quota = registeredItems.find((i) => i.id === 'omniterm.quotaChips')
    expect(quota?.align).toBe('left')
    expect(quota?.priority).toBe(-1)

    unregister()
  })

  it('renders StatusBarQuotaChips only while the footer dock is on and an agent profile has a reading', () => {
    updateQuota(() => initialQuotaState())
    const { unmount } = render(<StatusBarQuotaChips />)
    expect(screen.queryByTestId('status-bar-quota-chips')).toBeNull()
    unmount()

    updateQuota((s) => ({
      ...s,
      available: true,
      config: { ...s.config, enabled: true, dock: 'footer' },
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
          snapshot: { fetchedAt: Date.now(), windows: [{ kind: 'session', label: '5h', usedPct: 42, resetsAt: Date.now() + 3600000 }] },
        },
      },
    }))
    render(<StatusBarQuotaChips />)
    expect(screen.getByTestId('status-bar-quota-chips').textContent).toContain('42%')
  })

  it('shows each running profile by name, the one nearest its 5h limit first', () => {
    const snapshot = (usedPct: number) => ({
      fetchedAt: Date.now(),
      windows: [{ kind: 'session' as const, label: '5h', usedPct, resetsAt: Date.now() + 3600000 }],
    })
    const profileOf = (key: string, profileName: string, usedPct: number) => ({
      key, agent: 'claude' as const, profileName, profileDir: null, launcher: null, history: [],
      errorStreak: 0, nextFetchAt: 0, fetching: false, wake: {}, waking: false, snapshot: snapshot(usedPct),
    })
    const terminalOf = (sessionId: string, profileKey: string, profileName: string) => ({
      sessionId, agent: 'claude' as const, pid: 1, startTime: 1, profileDir: null, profileName,
      subAgentCount: 0, launcher: null, instanceKey: `${sessionId}:1:1`, profileKey,
    })
    updateQuota((s) => ({
      ...s,
      available: true,
      config: { ...s.config, enabled: true, dock: 'footer' },
      terminals: { a: terminalOf('a', 'claude:work', 'work'), b: terminalOf('b', 'claude:home', 'home') },
      profiles: {
        'claude:work': profileOf('claude:work', 'work', 35),
        'claude:home': profileOf('claude:home', 'home', 87),
        'claude:idle': profileOf('claude:idle', 'idle', 99),
      },
    }))
    render(<StatusBarQuotaChips />)
    const rows = screen.getAllByTestId('quota-footer-profile').map((row) => row.textContent)
    expect(rows).toEqual(['home87%', 'work35%'])
  })
})
