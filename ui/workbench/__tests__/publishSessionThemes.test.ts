/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MainLayoutModel } from '../../components/useMainLayoutController'
import { resetSessionBridge, useSessionBridge } from '../sessions/sessionBridge'
import { usePublishSessionBridge } from '../sessions/usePublishSessionBridge'

const onThemeApply = vi.fn()
const model = (resolveThemeId: string | null) =>
  ({
    activeTabs: [{ id: 't1', connId: 'c1', name: 'pwsh' }],
    editorTabs: {},
    connById: () => ({ id: 'c1', type: 'LOCAL', localCwd: 'D:\\work' }),
    workspaces: [],
    statuses: { t1: 'connected' },
    activity: {},
    sessionCwds: {},
    latencies: {},
    metrics: {},
    connectedAt: {},
    themes: [{ id: 'dark', name: 'Dark' }, { id: 'light', name: 'Light' }],
    appSettings: { themeId: 'dark' },
    resolveAppearance: () => (resolveThemeId ? { themeId: resolveThemeId } : null),
    onThemeApply,
  }) as unknown as MainLayoutModel

afterEach(() => {
  resetSessionBridge()
  vi.clearAllMocks()
})

describe('session bridge terminal themes', () => {
  it('lists the themes with the session’s own one as current', () => {
    renderHook(() => usePublishSessionBridge(model('light'), true))
    const api = useSessionBridge.getState().api
    expect(api?.terminalThemes?.('t1')).toEqual({
      themes: [{ id: 'dark', name: 'Dark' }, { id: 'light', name: 'Light' }],
      current: 'light',
    })
    expect(api?.terminalThemes?.('unknown')).toBeNull()
  })

  it('falls back to the app theme when the session has none of its own', () => {
    renderHook(() => usePublishSessionBridge(model(null), true))
    expect(useSessionBridge.getState().api?.terminalThemes?.('t1')?.current).toBe('dark')
  })

  it('applies a theme to that session only', () => {
    renderHook(() => usePublishSessionBridge(model(null), true))
    const api = useSessionBridge.getState().api
    api?.applyTerminalTheme?.('t1', 'light')
    api?.applyTerminalTheme?.('unknown', 'light')
    expect(onThemeApply).toHaveBeenCalledExactlyOnceWith('light', { id: 't1', connId: 'c1' })
  })
})
