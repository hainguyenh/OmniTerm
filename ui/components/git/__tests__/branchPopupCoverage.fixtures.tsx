import { act, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { vi } from 'vitest'

import { GitBranchPopup } from '../GitBranchPopup'
import type { GitBranchInfo } from '../gitTypes'

type InvokeHandler = (args: Record<string, unknown>) => unknown

/** Every Tauri `invoke` from the popup lands here; tests register per-command answers. */
export const mockInvoke = vi.fn()

export function branch(name: string, overrides: Partial<GitBranchInfo> = {}): GitBranchInfo {
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

export const MAIN = branch('main', { is_current: true, upstream: 'origin/main' })
export const TOPIC = branch('feature/topic', { upstream: 'origin/topic', behind: 1 })
export const REMOTE = branch('origin/main', { is_remote: true })

/** Answers `git_branches` with `branches` and other commands with `handlers` (default: empty output). */
export function answerInvoke(branches: GitBranchInfo[], handlers: Record<string, InvokeHandler> = {}) {
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    if (handlers[cmd]) return handlers[cmd](args)
    if (cmd === 'git_branches') return branches
    return ''
  })
}

export async function renderPopup(props: Partial<ComponentProps<typeof GitBranchPopup>> = {}) {
  const onClose = vi.fn()
  const view = await act(async () => render(<GitBranchPopup cwd="/work/repo" currentBranch="main" onClose={onClose} {...props} />))
  return { ...view, onClose }
}
