/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GitBranchSubmenu } from '../GitBranchSubmenu'
import { GitBranchTreeView } from '../GitBranchTreeView'
import {
  buildBranchTree,
  filterBranchTree,
  type GitBranchFolderNode,
  type GitBranchTreeNode,
} from '../gitBranchTreeUtils'
import type { GitBranchInfo } from '../gitTypes'

function branch(name: string, overrides: Partial<GitBranchInfo> = {}): GitBranchInfo {
  return {
    name,
    is_current: false,
    is_remote: false,
    ahead: 0,
    behind: 0,
    is_gone: false,
    ...overrides,
  }
}

function folder(nodes: GitBranchTreeNode[], name: string): GitBranchFolderNode {
  const found = nodes.find((node) => node.type === 'folder' && node.name === name)
  if (!found || found.type !== 'folder') throw new Error(`folder ${name} not found`)
  return found
}

function submenuActions() {
  return {
    onCheckout: vi.fn(),
    onMerge: vi.fn(),
    onRebase: vi.fn(),
    onNewBranchFrom: vi.fn(),
    onClose: vi.fn(),
  }
}

describe('buildBranchTree', () => {
  it('compacts single-child folder chains at the root and inside folders', () => {
    const tree = buildBranchTree([
      branch('release/v1/hotfix'),
      branch('team/a/b/x'),
      branch('team/c'),
    ])

    const release = folder(tree, 'release/v1')
    expect(release.path).toBe('release/v1')
    expect(release.children).toEqual([expect.objectContaining({ type: 'branch', displayName: 'hotfix' })])

    const team = folder(tree, 'team')
    const nested = folder(team.children, 'a/b')
    expect(nested.path).toBe('team/a/b')
    expect(team.allBranches.map((item) => item.name)).toEqual(['team/a/b/x', 'team/c'])
  })

  it('lists the current branch first, then the rest alphabetically', () => {
    const tree = buildBranchTree([
      branch('zeta'),
      branch('main', { is_current: true }),
      branch('alpha'),
      branch('beta'),
    ])

    expect(tree.map((node) => node.name)).toEqual(['main', 'alpha', 'beta', 'zeta'])
  })
})

describe('filterBranchTree', () => {
  const tree = buildBranchTree([
    branch('main'),
    branch('feature/auth/login'),
    branch('feature/auth/signup'),
    branch('feature/ui'),
    branch('bugfix/typo'),
  ])

  it('returns the original nodes for a blank query', () => {
    expect(filterBranchTree(tree, '   ')).toBe(tree)
  })

  it('recomputes folder counts from the nested matches only', () => {
    const filtered = filterBranchTree(tree, 'AUTH')
    expect(filtered).toHaveLength(1)
    const feature = folder(filtered, 'feature')
    expect(feature.allBranches.map((item) => item.name)).toEqual(['feature/auth/login', 'feature/auth/signup'])
    expect(feature.children).toHaveLength(1)
  })

  it('keeps matching root branches and drops folders without matches', () => {
    expect(filterBranchTree(tree, 'main').map((node) => node.name)).toEqual(['main'])
  })
})

describe('GitBranchSubmenu', () => {
  it('shows only the new-branch action for the current branch', () => {
    const actions = submenuActions()
    render(<GitBranchSubmenu branch={branch('main', { is_current: true })} {...actions} onCompare={vi.fn()} onDelete={vi.fn()} onUpdate={vi.fn()} />)

    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.queryByText('Checkout')).not.toBeInTheDocument()
    expect(screen.queryByText(/Compare with/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Merge/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText("New Branch from 'main'..."))
    expect(actions.onNewBranchFrom).toHaveBeenCalledWith('main')
    expect(actions.onClose).toHaveBeenCalledTimes(1)
  })

  it('treats the branch named as current as checked out', () => {
    render(<GitBranchSubmenu branch={branch('dev')} currentBranch="dev" {...submenuActions()} />)
    expect(screen.queryByText('Checkout')).not.toBeInTheDocument()
  })

  it('runs every local-branch action against HEAD when no current branch is known', () => {
    const actions = submenuActions()
    const onCompare = vi.fn()
    const onDelete = vi.fn()
    const onUpdate = vi.fn()
    const parentClick = vi.fn()
    render(
      <div onClick={parentClick}>
        <GitBranchSubmenu branch={branch('topic')} {...actions} onCompare={onCompare} onDelete={onDelete} onUpdate={onUpdate} />
      </div>,
    )

    fireEvent.click(screen.getByText('Update without checkout…'))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText("Compare with 'HEAD'..."))
    expect(onCompare).toHaveBeenCalledWith('topic')
    fireEvent.click(screen.getByText("Merge 'topic' into 'HEAD'"))
    expect(actions.onMerge).toHaveBeenCalledWith('topic')
    fireEvent.click(screen.getByText("Rebase 'HEAD' onto 'topic'"))
    expect(actions.onRebase).toHaveBeenCalledWith('topic')
    fireEvent.click(screen.getByText("Delete 'topic'..."))
    expect(onDelete).toHaveBeenCalledWith('topic')
    expect(actions.onClose).toHaveBeenCalledTimes(5)
    expect(parentClick).not.toHaveBeenCalled()
  })

  it('uses compact labels inline and names the current branch', () => {
    render(<GitBranchSubmenu branch={branch('topic')} currentBranch="main" inline compact {...submenuActions()} onCompare={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.getByRole('group', { name: 'Branch actions for topic' })).toHaveClass('git-branch-action-list')
    expect(screen.queryByText('topic')).not.toBeInTheDocument()
    for (const label of ['New branch…', 'Compare…', 'Merge into current…', 'Rebase current…', 'Delete branch…']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('offers a local checkout for a remote branch but never deletion', () => {
    const actions = submenuActions()
    render(<GitBranchSubmenu branch={branch('origin/topic', { is_remote: true })} currentBranch="main" {...actions} onDelete={vi.fn()} onUpdate={vi.fn()} />)

    expect(screen.queryByText('Checkout')).not.toBeInTheDocument()
    expect(screen.queryByText('Update without checkout…')).not.toBeInTheDocument()
    expect(screen.queryByText(/Delete/)).not.toBeInTheDocument()
    expect(screen.getByText("Merge 'origin/topic' into 'main'")).toBeInTheDocument()
    fireEvent.click(screen.getByText('Checkout as New Local Branch'))
    expect(actions.onCheckout).toHaveBeenCalledWith('origin/topic')
  })
})

describe('GitBranchTreeView', () => {
  const topic = branch('feature/topic', { ahead: 2, behind: 3, is_gone: true })
  const remote = branch('origin/main', { is_remote: true })
  const nodes = buildBranchTree([topic, branch('main', { is_current: true })])

  it('toggles folders independently of the collapsed default', () => {
    render(<GitBranchTreeView nodes={nodes} selectedBranch={null} collapsed onSelectBranch={vi.fn()} />)

    const toggle = screen.getByRole('button', { name: 'Expand branch folder feature' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Branch feature/topic' })).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Collapse branch folder feature' })).toHaveAttribute('aria-expanded', 'true')

    const leaf = screen.getByRole('button', { name: 'Branch feature/topic' })
    expect(leaf).toHaveTextContent('↑2')
    expect(leaf).toHaveTextContent('↓3')
    expect(leaf).toHaveTextContent('Gone')
    expect(screen.getByRole('button', { name: 'Branch main, current branch' })).toHaveTextContent('HEAD')
  })

  it('selects and deselects branches in legacy inline mode', () => {
    const onSelectBranch = vi.fn()
    const { rerender } = render(<GitBranchTreeView nodes={nodes} selectedBranch={null} onSelectBranch={onSelectBranch} />)

    const leaf = screen.getByRole('button', { name: 'Branch feature/topic' })
    expect(leaf).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(leaf)
    expect(onSelectBranch).toHaveBeenLastCalledWith(topic)
    fireEvent.contextMenu(leaf)
    expect(onSelectBranch).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(leaf, { key: 'ContextMenu' })
    fireEvent.keyDown(leaf, { key: 'F10', shiftKey: true })
    fireEvent.keyDown(leaf, { key: 'F10' })
    fireEvent.keyDown(leaf, { key: 'Enter' })
    expect(onSelectBranch).toHaveBeenCalledTimes(4)
    fireEvent.click(screen.getByRole('button', { name: 'Actions for feature/topic' }))
    expect(onSelectBranch).toHaveBeenCalledTimes(5)

    rerender(<GitBranchTreeView nodes={nodes} selectedBranch={topic} onSelectBranch={onSelectBranch} />)
    const selected = screen.getByRole('button', { name: 'Branch feature/topic' })
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    expect(selected.parentElement).toHaveClass('is-selected')
    expect(screen.queryByRole('group', { name: /Branch actions/ })).not.toBeInTheDocument()
    fireEvent.click(selected)
    expect(onSelectBranch).toHaveBeenLastCalledWith(null)
  })

  it('shows the inline action list for the selected branch when legacy actions are given', () => {
    const onSelectBranch = vi.fn()
    const onCheckout = vi.fn()
    render(
      <GitBranchTreeView
        nodes={nodes}
        currentBranch="main"
        selectedBranch={topic}
        onSelectBranch={onSelectBranch}
        onCheckout={onCheckout}
        onMerge={vi.fn()}
        onRebase={vi.fn()}
        onNewBranchFrom={vi.fn()}
      />,
    )

    expect(screen.getByRole('group', { name: 'Branch actions for feature/topic' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Checkout'))
    expect(onCheckout).toHaveBeenCalledWith('feature/topic')
    expect(onSelectBranch).toHaveBeenCalledWith(null)
  })

  it('opens the context menu at the pointer or below the focused control', () => {
    const onSelectBranch = vi.fn()
    const onContextBranch = vi.fn()
    render(<GitBranchTreeView nodes={[{ type: 'branch', name: remote.name, displayName: remote.name, branch: remote }]} selectedBranch={remote} onSelectBranch={onSelectBranch} onContextBranch={onContextBranch} />)

    const leaf = screen.getByRole('button', { name: 'Branch origin/main' })
    expect(leaf).not.toHaveAttribute('aria-expanded')
    fireEvent.click(leaf)
    expect(onSelectBranch).toHaveBeenCalledWith(remote)

    fireEvent.contextMenu(leaf, { clientX: 15, clientY: 25 })
    expect(onContextBranch).toHaveBeenLastCalledWith(remote, { x: 15, y: 25 })
    fireEvent.keyDown(leaf, { key: 'ContextMenu' })
    expect(onContextBranch).toHaveBeenLastCalledWith(remote, { x: 0, y: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Actions for origin/main' }))
    expect(onContextBranch).toHaveBeenCalledTimes(3)
    expect(onSelectBranch).toHaveBeenCalledTimes(1)
  })
})
