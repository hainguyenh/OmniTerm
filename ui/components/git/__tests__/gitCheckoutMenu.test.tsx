/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GitProjectSelector } from '../GitProjectSelector'
import { GitWorktreeContext } from '../GitWorktreeContext'
import { GitWorktreeSelector } from '../GitWorktreeSelector'
import type { GitWorktreeInfo } from '../gitTypes'

const checkout = (path: string, extra: Partial<GitWorktreeInfo> = {}): GitWorktreeInfo => ({
  path,
  branch: 'feature/ui',
  is_main: false,
  is_current: false,
  is_detached: false,
  is_bare: false,
  is_locked: false,
  is_prunable: false,
  ...extra,
})
const MAIN = checkout('D:/repo', { branch: 'develop', is_main: true, is_current: true })
const LINKED = checkout('D:/repo/.worktrees/ui', { is_locked: true })
const MISSING = checkout('D:/repo/.worktrees/missing', { is_prunable: true })
const WORKTREES = [LINKED, MISSING, MAIN]

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function openPicker(activePath = LINKED.path) {
  const select = vi.fn()
  render(<GitWorktreeSelector repoName="OmniTerm" worktrees={WORKTREES} activePath={activePath} onSelectWorktree={select} />)
  const trigger = screen.getByRole('button', { name: 'Select worktree' })
  fireEvent.click(trigger)
  return { trigger, select, menu: screen.getByRole('dialog', { name: 'Checkouts of OmniTerm' }) }
}

describe('checkout menu UX', () => {
  it('groups the main checkout first and makes selection, locks and missing folders explicit', () => {
    const { trigger, menu, select } = openPicker('d:\\REPO\\.worktrees\\ui')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(menu).toHaveAttribute('id', trigger.getAttribute('aria-controls'))
    const choices = within(menu).getAllByRole('button').slice(1)
    expect(choices[0]).toHaveAccessibleName('Main checkout · develop')
    expect(choices[1]).toHaveAttribute('aria-pressed', 'true')
    expect(choices[1]).toHaveFocus()
    expect(within(choices[1]).getByText('Locked')).toBeInTheDocument()
    expect(within(choices[1]).getByText(LINKED.path)).toBeInTheDocument()
    expect(choices[2]).toBeDisabled()
    fireEvent.click(choices[2])
    expect(select).not.toHaveBeenCalled()
    fireEvent.click(choices[0])
    expect(select).toHaveBeenCalledExactlyOnceWith(MAIN.path)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('supports arrows, Home, End and Escape without focusing unavailable checkouts', () => {
    const { trigger, menu } = openPicker()
    const main = within(menu).getByRole('button', { name: 'Main checkout · develop' })
    const linked = within(menu).getByRole('button', { name: 'ui · feature/ui' })
    fireEvent.keyDown(linked, { key: 'ArrowDown' })
    expect(main).toHaveFocus()
    fireEvent.keyDown(main, { key: 'ArrowUp' })
    expect(linked).toHaveFocus()
    fireEvent.keyDown(linked, { key: 'Home' })
    expect(main).toHaveFocus()
    fireEvent.keyDown(main, { key: 'End' })
    expect(linked).toHaveFocus()
    fireEvent.keyDown(linked, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
  })

  it('closes on outside pointer input, tabbing out, the close button and the trigger', () => {
    const { trigger, menu } = openPicker()
    fireEvent.mouseDown(menu)
    expect(menu).toBeInTheDocument()
    fireEvent.mouseDown(trigger)
    fireEvent.click(trigger)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Close checkout picker' }))
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.blur(screen.getByRole('dialog'), { relatedTarget: document.body })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('fits a narrow viewport and opens above an anchor near the bottom', () => {
    vi.stubGlobal('innerWidth', 320)
    vi.stubGlobal('innerHeight', 600)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(280, 500, 32, 36))
    const { menu } = openPicker()
    expect(menu.style.width).toBe('304px')
    expect(menu.style.left).toBe('8px')
    expect(menu.style.bottom).toBe('108px')
    expect(menu.style.maxHeight).toBe('484px')
    vi.stubGlobal('innerWidth', 800)
    fireEvent.resize(window)
    expect(menu.style.width).toBe('440px')
  })

  it('resets the open checkout menu when switching repositories', () => {
    const projects = [
      { id: 'repo', name: 'Repo', path: MAIN.path, category: 'Workspace' },
      { id: 'other', name: 'Other', path: 'D:/other', category: 'Workspace' },
    ]
    const props = { projects, onSelectProject: vi.fn(), worktrees: WORKTREES, onSelectWorktree: vi.fn() }
    const { rerender } = render(<GitProjectSelector {...props} selectedPath={MAIN.path} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select worktree' }))
    rerender(<GitProjectSelector {...props} selectedPath="D:/other" />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select worktree' })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('active checkout context', () => {
  it('shows the selected path and branch and returns to the main checkout through the existing callback', () => {
    const select = vi.fn()
    const { rerender } = render(<GitWorktreeContext worktrees={WORKTREES} activePath={LINKED.path} onSelectWorktree={select} />)
    const context = screen.getByLabelText('Active Git checkout')
    expect(context).toHaveTextContent('Viewing changes inuiWorktreefeature/ui')
    expect(context).toHaveTextContent(LINKED.path)
    fireEvent.click(screen.getByRole('button', { name: 'Back to main checkout' }))
    expect(select).toHaveBeenCalledExactlyOnceWith(MAIN.path)
    rerender(<GitWorktreeContext worktrees={WORKTREES} activePath={MAIN.path} onSelectWorktree={select} />)
    expect(context).toHaveTextContent('develop')
    expect(screen.queryByRole('button', { name: 'Back to main checkout' })).not.toBeInTheDocument()
  })

  it('omits an unnecessary single-checkout context and unavailable main actions', () => {
    const { container, rerender } = render(<GitWorktreeContext worktrees={[MAIN]} activePath={MAIN.path} onSelectWorktree={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<GitWorktreeContext worktrees={[LINKED, { ...MAIN, is_prunable: true }]} activePath={LINKED.path} onSelectWorktree={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Back to main checkout' })).not.toBeInTheDocument()
  })
})
