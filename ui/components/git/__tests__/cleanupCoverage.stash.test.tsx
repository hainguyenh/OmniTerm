/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GitStashModal } from '../GitStashModal'
import type { GitStashEntry } from '../gitTypes'

const STASHES: GitStashEntry[] = [
  { index: 0, name: 'stash@{0}', message: 'WIP on main', timestamp: '2 hours ago' },
  { index: 1, name: 'stash@{1}', message: 'no timestamp entry' },
]

const mockInvoke = vi.fn()
type Handler = (args: Record<string, unknown>) => Promise<unknown>
let handlers: Record<string, Handler> = {}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

const callsTo = (cmd: string) => mockInvoke.mock.calls.filter(([name]) => name === cmd).map(([, args]) => args)

async function renderStash(onRefresh?: () => void) {
  const onClose = vi.fn()
  await act(async () => {
    render(<GitStashModal cwd="/repo" onClose={onClose} onRefresh={onRefresh} />)
  })
  return { onClose }
}

describe('GitStashModal coverage', () => {
  beforeEach(() => {
    handlers = {
      git_stash_list: () => Promise.resolve(STASHES),
      git_stash_save: () => Promise.resolve(''),
      git_stash_pop: () => Promise.resolve(''),
      git_stash_apply: () => Promise.resolve(''),
      git_stash_drop: () => Promise.resolve('dropped'),
    }
    mockInvoke.mockReset()
    mockInvoke.mockImplementation((cmd: string, args: Record<string, unknown>) => handlers[cmd]?.(args) ?? Promise.resolve(null))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists stashes with optional timestamps', async () => {
    await renderStash()
    expect(screen.getByText('Git Stashes (2)')).toBeInTheDocument()
    expect(screen.getByText('· 2 hours ago')).toBeInTheDocument()
    expect(screen.getAllByText(/^· /)).toHaveLength(1)
    expect(screen.getByText('no timestamp entry')).toBeInTheDocument()
  })

  it('shows loading and empty states', async () => {
    let resolveList: (value: GitStashEntry[]) => void = () => undefined
    handlers.git_stash_list = () => new Promise((resolve) => { resolveList = resolve })
    await renderStash()
    expect(screen.getByText('Loading stashes...')).toBeInTheDocument()
    await act(async () => {
      resolveList([])
    })
    expect(screen.getByText('No stashes saved in this repository')).toBeInTheDocument()
  })

  it('reports a failure to load stashes', async () => {
    handlers.git_stash_list = () => Promise.reject('not a repo')
    await renderStash()
    expect(screen.getByText('Failed to load stashes: not a repo')).toBeInTheDocument()
    expect(screen.getByText('No stashes saved in this repository')).toBeInTheDocument()
  })

  it('saves a trimmed message with keep-index and falls back to a default notice', async () => {
    const onRefresh = vi.fn()
    const refreshEvents = vi.fn()
    window.addEventListener('omniterm:git-refresh', refreshEvents)
    await renderStash(onRefresh)
    const input = screen.getByPlaceholderText('Optional stash message...')
    fireEvent.change(input, { target: { value: '  my work  ' } })
    fireEvent.click(screen.getByRole('checkbox'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stash' }))
    })
    expect(callsTo('git_stash_save')).toEqual([{ cwd: '/repo', message: 'my work', keepIndex: true }])
    expect(screen.getByText('Changes stashed successfully')).toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(callsTo('git_stash_list')).toHaveLength(2)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(refreshEvents).toHaveBeenCalledTimes(1)
    window.removeEventListener('omniterm:git-refresh', refreshEvents)
  })

  it('saves without a message, shows git output, and disables actions while saving', async () => {
    let resolveSave: (value: string) => void = () => undefined
    handlers.git_stash_save = () => new Promise((resolve) => { resolveSave = resolve })
    await renderStash()
    fireEvent.change(screen.getByPlaceholderText('Optional stash message...'), { target: { value: '   ' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stash' }))
    })
    expect(callsTo('git_stash_save')).toEqual([{ cwd: '/repo', message: null, keepIndex: false }])
    expect(screen.getByRole('button', { name: 'Stash' })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: /Pop/ })[0]).toBeDisabled()

    await act(async () => {
      resolveSave('Saved working directory')
    })
    expect(screen.getByText('Saved working directory')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stash' })).toBeEnabled()
  })

  it('reports a failed save', async () => {
    handlers.git_stash_save = () => Promise.reject('nothing to stash')
    await renderStash()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stash' }))
    })
    expect(screen.getByText('Stash failed: nothing to stash')).toBeInTheDocument()
  })

  it('pops and applies stashes with fallback notices when git prints nothing', async () => {
    await renderStash()
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /Pop/ })[1])
    })
    expect(callsTo('git_stash_pop')).toEqual([{ cwd: '/repo', index: 1 }])
    expect(screen.getByText('Stash@{1} popped')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /Apply/ })[0])
    })
    expect(callsTo('git_stash_apply')).toEqual([{ cwd: '/repo', index: 0 }])
    expect(screen.getByText('Stash@{0} applied')).toBeInTheDocument()
  })

  it('shows git output for pop and apply and notifies the caller', async () => {
    handlers.git_stash_pop = () => Promise.resolve('Popped it')
    handlers.git_stash_apply = () => Promise.resolve('Applied it')
    const onRefresh = vi.fn()
    await renderStash(onRefresh)
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /Pop/ })[0])
    })
    expect(screen.getByText('Popped it')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /Apply/ })[0])
    })
    expect(screen.getByText('Applied it')).toBeInTheDocument()
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it('reports pop and apply failures', async () => {
    handlers.git_stash_pop = () => Promise.reject('conflict')
    handlers.git_stash_apply = () => Promise.reject('dirty tree')
    await renderStash()
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /Pop/ })[0])
    })
    expect(screen.getByText('Pop failed: conflict')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /Apply/ })[0])
    })
    expect(screen.getByText('Apply failed: dirty tree')).toBeInTheDocument()
  })

  it('drops a stash only after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await renderStash()
    const dropButtons = () => screen.getAllByTitle('Drop stash (permanently delete)')
    await act(async () => {
      fireEvent.click(dropButtons()[1])
    })
    expect(confirm).toHaveBeenCalledWith('Are you sure you want to drop stash@{1}?')
    expect(callsTo('git_stash_drop')).toEqual([])

    confirm.mockReturnValue(true)
    await act(async () => {
      fireEvent.click(dropButtons()[1])
    })
    expect(callsTo('git_stash_drop')).toEqual([{ cwd: '/repo', index: 1 }])
    expect(screen.getByText('Stash@{1} dropped')).toBeInTheDocument()
    expect(callsTo('git_stash_list')).toHaveLength(2)
  })

  it('reports a failed drop', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    handlers.git_stash_drop = () => Promise.reject('locked')
    await renderStash()
    await act(async () => {
      fireEvent.click(screen.getAllByTitle('Drop stash (permanently delete)')[0])
    })
    expect(screen.getByText('Drop failed: locked')).toBeInTheDocument()
  })

  it('closes on Escape, the close button, and backdrop clicks only', async () => {
    const { onClose } = await renderStash()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('Git Stashes (2)'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('dialog', { name: 'Git Stash Manager' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByTitle('Close (Esc)'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
