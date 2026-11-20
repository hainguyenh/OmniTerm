import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openGitToolWindow } from '../openGitToolWindow'

const slotOfId = vi.fn()
const showToolWindow = vi.fn()
vi.mock('../../ide/workbench/toolwindows/store', () => ({
  slotOfId: (id: string) => slotOfId(id),
  showToolWindow: (...args: unknown[]) => showToolWindow(...args),
}))

describe('openGitToolWindow', () => {
  beforeEach(() => {
    slotOfId.mockReset()
    showToolWindow.mockReset()
  })

  it('prefers the Commit window when it is registered', () => {
    slotOfId.mockImplementation((id: string) => (id === 'commit' || id === 'git' ? 'left' : undefined))
    expect(openGitToolWindow()).toBe(true)
    expect(showToolWindow).toHaveBeenCalledWith('commit', true)
  })

  it('falls back to the Git log window', () => {
    slotOfId.mockImplementation((id: string) => (id === 'git' ? 'bottom' : undefined))
    expect(openGitToolWindow()).toBe(true)
    expect(showToolWindow).toHaveBeenCalledWith('git', true)
  })

  it('does nothing while the VCS feature has registered no window', () => {
    slotOfId.mockReturnValue(undefined)
    expect(openGitToolWindow()).toBe(false)
    expect(showToolWindow).not.toHaveBeenCalled()
  })
})
