/** @vitest-environment jsdom */
import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GitBranchInfo } from '../gitTypes'
import { MAIN, REMOTE, TOPIC, answerInvoke, branch, mockInvoke, renderPopup } from './branchPopupCoverage.fixtures'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => mockInvoke(cmd, args),
}))

function browser() {
  return screen.getByRole('region', { name: 'Branch browser' })
}

function popup() {
  return screen.getByRole('dialog', { name: 'Git Branches' })
}

/** jsdom lays nothing out, so mark only buttons as visible to give the focus trap a stable order. */
function showButtonsOnly() {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    const rects = this.tagName === 'BUTTON' ? [new DOMRect(0, 0, 10, 10)] : []
    return rects as unknown as DOMRectList
  })
}

/** An SVG element can hold focus but is not an HTMLElement, so it is never a focus-return target. */
function focusedSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('tabindex', '0')
  document.body.appendChild(svg)
  svg.focus()
  return svg
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GitBranchPopup browsing', () => {
  it('shows HEAD and the raw path when neither a branch nor a folder name is known', async () => {
    answerInvoke([])
    const { onClose } = await renderPopup({ cwd: '/', currentBranch: undefined })

    expect(screen.getByText('Working on').parentElement).toHaveTextContent('Working on HEAD')
    expect(screen.getByTitle('/')).toHaveTextContent('/')
    expect(within(browser()).getByRole('heading', { name: 'No branches yet' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search branches' }), { target: { value: 'nope' } })
    expect(within(browser()).getByRole('heading', { name: 'No matching branches' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New branch' }))
    expect(screen.getByRole('textbox', { name: /Create from HEAD/ })).toBeInTheDocument()
    fireEvent.keyDown(popup(), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: /Create from/ })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(popup(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows a loading state until the first branch list arrives', async () => {
    let resolveBranches: (value: GitBranchInfo[]) => void = () => undefined
    answerInvoke([], { git_branches: () => new Promise((resolve) => { resolveBranches = resolve }) })
    await renderPopup()

    expect(within(browser()).getByText('Loading branches…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh Branches' })).toBeDisabled()
    await act(async () => { resolveBranches([MAIN]) })
    expect(within(browser()).getByRole('button', { name: 'Branch main, current branch' })).toBeInTheDocument()
    expect(within(browser()).queryByRole('button', { name: 'Remote branches' })).not.toBeInTheDocument()
  })

  it('collapses groups and folders, and search reveals everything again', async () => {
    answerInvoke([MAIN, TOPIC, REMOTE])
    await renderPopup()

    const local = within(browser()).getByRole('button', { name: /Local branches/ })
    fireEvent.click(local)
    expect(local).toHaveAttribute('aria-expanded', 'false')
    expect(within(browser()).queryByRole('button', { name: /^Branch main/ })).not.toBeInTheDocument()
    const remote = within(browser()).getByRole('button', { name: /Remote branches/ })
    fireEvent.click(remote)
    expect(remote).toHaveAttribute('aria-expanded', 'false')
    expect(within(browser()).queryByRole('button', { name: 'Branch origin/main' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all branch folders' }))
    expect(local).toHaveAttribute('aria-expanded', 'true')
    expect(remote).toHaveAttribute('aria-expanded', 'true')
    expect(within(browser()).getByRole('button', { name: 'Expand branch folder feature' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search branches' }), { target: { value: 'topic' } })
    expect(within(browser()).getByRole('button', { name: 'Branch feature/topic' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search branches' }), { target: { value: '' } })
    expect(within(browser()).getByRole('button', { name: 'Expand branch folder feature' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand all branch folders' }))
    expect(within(browser()).getByRole('button', { name: 'Collapse branch folder feature' })).toBeInTheDocument()

    fireEvent.click(within(browser()).getByRole('button', { name: 'List' }))
    expect(screen.getByRole('button', { name: 'Expand all branch folders' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Collapse all branch folders' })).toBeDisabled()
    fireEvent.click(within(browser()).getByRole('button', { name: 'Tree' }))
    expect(within(browser()).getByRole('button', { name: 'Tree' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('inspects the selected branch and falls back when it disappears', async () => {
    answerInvoke([MAIN, TOPIC, REMOTE])
    await renderPopup()

    const inspector = () => screen.getByRole('complementary', { name: 'Selected branch details' })
    expect(within(inspector()).getByRole('heading', { name: 'main' })).toBeInTheDocument()
    fireEvent.click(within(browser()).getByRole('button', { name: 'Branch feature/topic' }))
    expect(within(inspector()).getByRole('heading', { name: 'feature/topic' })).toBeInTheDocument()

    answerInvoke([branch('main')])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh Branches' })) })
    expect(screen.queryByRole('complementary', { name: 'Selected branch details' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your branches, in focus' })).toBeInTheDocument()
  })

  it('inspects the branch named as current even when git did not flag it', async () => {
    answerInvoke([branch('dev'), branch('main')])
    await renderPopup()

    const inspector = screen.getByRole('complementary', { name: 'Selected branch details' })
    expect(within(inspector).getByRole('heading', { name: 'main' })).toBeInTheDocument()
    expect(within(inspector).getByText('Checked out')).toBeInTheDocument()
  })

  it('closes from the backdrop and the close button only', async () => {
    answerInvoke([MAIN])
    const { onClose } = await renderPopup()

    fireEvent.click(popup())
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(popup().parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close branch menu' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('traps Tab focus within the popup', async () => {
    answerInvoke([MAIN])
    showButtonsOnly()
    await renderPopup()

    const first = screen.getByRole('button', { name: 'Close branch menu' })
    const last = screen.getByRole('button', { name: 'Cleanup & prune' })
    first.focus()
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(first).toHaveFocus()

    const fetchButton = screen.getByRole('button', { name: 'Fetch Remotes' })
    fetchButton.focus()
    fireEvent.keyDown(fetchButton, { key: 'Tab' })
    fireEvent.keyDown(fetchButton, { key: 'Tab', shiftKey: true })
    expect(fetchButton).toHaveFocus()
  })

  it('ignores Tab when no control is visible', async () => {
    answerInvoke([MAIN])
    await renderPopup()

    const search = screen.getByRole('searchbox', { name: 'Search branches' })
    expect(search).toHaveFocus()
    fireEvent.keyDown(search, { key: 'Tab', shiftKey: true })
    expect(search).toHaveFocus()
  })

  it('restores focus to the opener on unmount', async () => {
    answerInvoke([MAIN])
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = await renderPopup()
    expect(opener).not.toHaveFocus()
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('leaves focus alone when a non-HTML element held it', async () => {
    answerInvoke([MAIN, TOPIC])
    const svg = focusedSvg()
    const { unmount } = await renderPopup()

    svg.focus()
    fireEvent.contextMenu(within(browser()).getByRole('button', { name: 'Branch feature/topic' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close branch actions' }))
    expect(screen.queryByRole('dialog', { name: 'Actions for feature/topic' })).not.toBeInTheDocument()
    expect(svg).not.toHaveFocus()

    unmount()
    expect(svg).not.toHaveFocus()
    svg.remove()
  })
})

describe('GitBranchPopup context menu', () => {
  it('opens at the pointer, traps focus inside, and closes on Escape', async () => {
    answerInvoke([MAIN, TOPIC])
    showButtonsOnly()
    const { onClose } = await renderPopup()

    const leaf = within(browser()).getByRole('button', { name: 'Branch feature/topic' })
    leaf.focus()
    fireEvent.contextMenu(leaf, { clientX: 20, clientY: 30 })
    const menu = screen.getByRole('dialog', { name: 'Actions for feature/topic' })
    const close = within(menu).getByRole('button', { name: 'Close branch actions' })
    const deleteButton = within(menu).getByRole('button', { name: 'Delete branch…' })
    close.focus()
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(deleteButton).toHaveFocus()
    fireEvent.keyDown(deleteButton, { key: 'Tab' })
    expect(close).toHaveFocus()

    fireEvent.keyDown(close, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Actions for feature/topic' })).not.toBeInTheDocument()
    expect(leaf).toHaveFocus()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('opens the update dialog from the menu and leaves popup keys to it', async () => {
    answerInvoke([MAIN, TOPIC], { git_update_branch: () => 'Fast-forwarded' })
    const { onClose } = await renderPopup()

    fireEvent.contextMenu(within(browser()).getByRole('button', { name: 'Branch feature/topic' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update without checkout…' }))
    const dialog = screen.getByRole('dialog', { name: 'Update feature/topic without checkout' })
    expect(screen.queryByRole('dialog', { name: 'Actions for feature/topic' })).not.toBeInTheDocument()

    fireEvent.keyDown(dialog, { key: 'Enter' })
    expect(dialog).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /Update feature\/topic/ })) })
    expect(mockInvoke).toHaveBeenCalledWith('git_update_branch', { cwd: '/work/repo', branch: 'feature/topic' })
    expect(screen.queryByRole('dialog', { name: /without checkout/ })).not.toBeInTheDocument()
    expect(screen.getByText('Fast-forwarded')).toBeInTheDocument()
  })
})
