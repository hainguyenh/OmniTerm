/**
 * @vitest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import type { MenuItem } from '../../ide/ui'
import { registerToolWindow, type ToolWindowContribution } from '../../ide/workbench/contributions'
import { ToolWindowLayout, ToolWindowStripe } from '../../ide/workbench/toolwindows/ToolWindows'
import { showToolWindow, type SlotRecord } from '../../ide/workbench/toolwindows/store'

const VISIBLE = { left: null, 'left-split': null, right: null, 'right-split': null, bottom: null, 'bottom-split': null } as SlotRecord

function runWindow(useBadge: () => number | string | null): ToolWindowContribution {
  return { id: 'run', title: 'Run', icon: 'run', anchor: 'left', component: () => null, useBadge }
}

// A feature's badge reads its own state; the adapter that replaces the window later reads a store.
function useFeatureBadge(): number {
  const [count] = useState(2)
  const [offset] = useState(1)
  return count + offset
}
const adapterBadge = (): number => 7

describe('tool window stripe badges', () => {
  // Regression: with features activated after the first paint, `run` drew its badge with a
  // hook-based counter and then `run-workbench` registered the same id with a plain one. The badge
  // called the new function in the old component and the window died with "Rendered more hooks".
  it('mounts a fresh badge when the window is registered again with another badge hook', () => {
    const { rerender } = render(<ToolWindowStripe side="left" windows={[runWindow(adapterBadge)]} visible={VISIBLE} />)
    expect(screen.getByText('7')).toBeTruthy()

    expect(() =>
      rerender(<ToolWindowStripe side="left" windows={[runWindow(useFeatureBadge)]} visible={VISIBLE} />),
    ).not.toThrow()
    expect(screen.getByText('3')).toBeTruthy()

    expect(() =>
      rerender(<ToolWindowStripe side="left" windows={[runWindow(adapterBadge)]} visible={VISIBLE} />),
    ).not.toThrow()
    expect(screen.getByText('7')).toBeTruthy()
  })

  // Regression: `code-insight`, now activated after the first paint, replaces OmniTerm's Problems
  // window with one whose header menu is a hook (`useProblemsHeaderMenu`). The open window's header
  // ran it in the component that had run the plain menu, and the whole window crashed.
  it('mounts a fresh header when an open window is registered again with a menu hook', () => {
    const Content = () => <div data-testid="problems-content" />
    const plain: Omit<ToolWindowContribution, 'headerMenu'> = { id: 'problems', title: 'Problems', icon: 'problems', anchor: 'bottom', component: Content, requiresProject: false }
    function useHookMenu(): MenuItem[] {
      const [items] = useState<MenuItem[]>([])
      const [extra] = useState<MenuItem[]>([])
      return [...items, ...extra]
    }
    let dispose = registerToolWindow({ ...plain, headerMenu: [] })
    try {
      render(<ToolWindowLayout editor={null} />)
      act(() => showToolWindow('problems'))
      expect(screen.getByTestId('problems-content')).toBeTruthy()

      expect(() =>
        act(() => {
          dispose = registerToolWindow({ ...plain, headerMenu: useHookMenu })
        }),
      ).not.toThrow()
      expect(screen.getByTestId('problems-content')).toBeTruthy()
    } finally {
      dispose()
    }
  })
})
