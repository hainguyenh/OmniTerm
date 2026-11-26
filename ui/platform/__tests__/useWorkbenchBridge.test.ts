/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { getAction } from '../../ide/platform/actions'
import { getContext } from '../../ide/platform/context'
import { bindingsFor } from '../../ide/platform/keymap'
import { useWorkbenchBridge } from '../useWorkbenchBridge'

const openGitToolWindow = vi.fn()
vi.mock('../openGitToolWindow', () => ({ openGitToolWindow: () => openGitToolWindow() }))

describe('useWorkbenchBridge', () => {
  it('registers the OmniTerm actions with the configured shortcut and removes them on unmount', () => {
    const { rerender, unmount } = renderHook(
      ({ shortcuts }) => useWorkbenchBridge({ shortcuts, focusedKind: null, sessionCount: 0 }),
      { initialProps: { shortcuts: { newSession: 'Ctrl+Alt+T' } as unknown as ShortcutBindings } },
    )
    expect(getAction('omniterm.newSession')).toBeTruthy()
    expect(bindingsFor('omniterm.newSession')).toEqual(['Ctrl+Alt+T'])

    rerender({ shortcuts: { newSession: 'Ctrl+Alt+Y' } as unknown as ShortcutBindings })
    expect(bindingsFor('omniterm.newSession')).toEqual(['Ctrl+Alt+Y'])

    unmount()
    expect(getAction('omniterm.newSession')).toBeUndefined()
  })

  it('publishes the focused pane and session count, and clears them on unmount', () => {
    const { rerender, unmount } = renderHook(
      ({ focusedKind, sessionCount }: { focusedKind: 'terminal' | 'editor' | null; sessionCount: number }) =>
        useWorkbenchBridge({ shortcuts: undefined, focusedKind, sessionCount }),
      { initialProps: { focusedKind: 'terminal' as 'terminal' | 'editor' | null, sessionCount: 2 } },
    )
    expect(getContext()).toMatchObject({ terminalFocus: true, editorFocus: false, sessionCount: 2 })

    rerender({ focusedKind: 'editor', sessionCount: 3 })
    expect(getContext()).toMatchObject({ terminalFocus: false, editorFocus: true, sessionCount: 3 })

    unmount()
    expect(getContext()).not.toHaveProperty('terminalFocus')
    expect(getContext()).not.toHaveProperty('sessionCount')
  })

  it('opens the Git window on the open-git event and stops listening on unmount', () => {
    openGitToolWindow.mockClear()
    const { unmount } = renderHook(() => useWorkbenchBridge({ shortcuts: undefined, focusedKind: null, sessionCount: 0 }))
    window.dispatchEvent(new CustomEvent('omniterm:open-git'))
    expect(openGitToolWindow).toHaveBeenCalledTimes(1)
    unmount()
    window.dispatchEvent(new CustomEvent('omniterm:open-git'))
    expect(openGitToolWindow).toHaveBeenCalledTimes(1)
  })
})
