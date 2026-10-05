import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createGitAPI } from '../gitAPI'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))

describe('createGitAPI', () => {
  const api = createGitAPI()

  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue('ok')
  })

  it('passes null for omitted optional arguments', async () => {
    await api.getFileHistory('/r', 'a.ts')
    await api.getLog('/r')
    await api.createBranch('/r', 'feat')
    await api.saveStash('/r')
    await api.popStash('/r')
    await api.applyStash('/r')
    await api.addWorktree('/r', 'feat')

    expect(mockInvoke.mock.calls).toEqual([
      ['git_file_history', { cwd: '/r', filePath: 'a.ts', startLine: null, endLine: null, limit: null }],
      ['git_log', { cwd: '/r', limit: null }],
      ['git_create_branch', { cwd: '/r', name: 'feat', startPoint: null, checkout: true }],
      ['git_stash_save', { cwd: '/r', message: null, keepIndex: false }],
      ['git_stash_pop', { cwd: '/r', index: null }],
      ['git_stash_apply', { cwd: '/r', index: null }],
      ['git_add_worktree', { cwd: '/r', branch: 'feat', path: null }],
    ])
  })

  it('forwards provided optional arguments unchanged', async () => {
    await api.getFileHistory('/r', 'a.ts', { start: 3, end: 9 }, 20)
    await api.getLog('/r', 50)
    await api.createBranch('/r', 'feat', 'main', false)
    await api.saveStash('/r', 'wip', true)
    await api.popStash('/r', 2)
    await api.applyStash('/r', 0)
    await api.addWorktree('/r', 'feat', '/wt')

    expect(mockInvoke.mock.calls).toEqual([
      ['git_file_history', { cwd: '/r', filePath: 'a.ts', startLine: 3, endLine: 9, limit: 20 }],
      ['git_log', { cwd: '/r', limit: 50 }],
      ['git_create_branch', { cwd: '/r', name: 'feat', startPoint: 'main', checkout: false }],
      ['git_stash_save', { cwd: '/r', message: 'wip', keepIndex: true }],
      ['git_stash_pop', { cwd: '/r', index: 2 }],
      ['git_stash_apply', { cwd: '/r', index: 0 }],
      ['git_add_worktree', { cwd: '/r', branch: 'feat', path: '/wt' }],
    ])
  })

  it('applies the default flags for branch deletion and remote operations', async () => {
    await api.deleteBranches('/r', ['a'])
    await api.deleteBranches('/r', ['b'], true)
    await api.fetch('/r')
    await api.fetch('/r', false)
    await api.pull('/r')
    await api.pull('/r', true)
    await api.push('/r')
    await api.push('/r', true)

    expect(mockInvoke.mock.calls).toEqual([
      ['git_delete_branches', { cwd: '/r', branches: ['a'], force: false }],
      ['git_delete_branches', { cwd: '/r', branches: ['b'], force: true }],
      ['git_fetch', { cwd: '/r', prune: true }],
      ['git_fetch', { cwd: '/r', prune: false }],
      ['git_pull', { cwd: '/r', rebase: false }],
      ['git_pull', { cwd: '/r', rebase: true }],
      ['git_push', { cwd: '/r', setUpstream: false }],
      ['git_push', { cwd: '/r', setUpstream: true }],
    ])
  })

  it('maps every remaining call to its IPC command', async () => {
    await api.getStatus('/r')
    await api.getDiff('/r', 'f', true)
    await api.getDiffBranch('/r', 'f', 'main')
    await api.getFileContext('ws', 'f')
    await api.getBlame('/r', 'f')
    await api.deleteFile('/r', 'f')
    await api.stage('/r', ['f'])
    await api.unstage('/r', ['f'])
    await api.revert('/r', ['f'])
    await api.commit('/r', 'msg', false)
    await api.getBranches('/r')
    await api.checkout('/r', 'main')
    await api.merge('/r', 'dev')
    await api.rebase('/r', 'dev')
    await api.init('/r')
    await api.readFile('/r', 'f')
    await api.readFileRevision('/r', 'f', 'HEAD')
    await api.writeFile('/r', 'f', 'x')
    await api.compareBranches('/r', 'main', 'dev')
    await api.getStashes('/r')
    await api.dropStash('/r', 1)
    await api.cherryPick('/r', 'abc')
    await api.updateBranch('/r', 'dev')
    await api.renameBranch('/r', 'dev', 'next')
    await api.setUpstream('/r', 'dev', null)

    expect(mockInvoke.mock.calls.map(([command]) => command)).toEqual([
      'git_status', 'git_diff', 'git_diff_branch', 'git_file_context', 'git_blame', 'git_delete_file',
      'git_stage', 'git_unstage', 'git_revert', 'git_commit', 'git_branches', 'git_checkout', 'git_merge',
      'git_rebase', 'git_init', 'git_read_file', 'git_read_file_revision', 'git_write_file',
      'git_compare_branches', 'git_stash_list', 'git_stash_drop', 'git_cherry_pick', 'git_update_branch',
      'git_rename_branch', 'git_set_upstream',
    ])
    expect(mockInvoke).toHaveBeenCalledWith('git_file_context', { workspaceId: 'ws', path: 'f' })
    expect(mockInvoke).toHaveBeenCalledWith('git_set_upstream', { cwd: '/r', branch: 'dev', upstream: null })
  })

  it('surfaces IPC rejections to the caller', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('not a repo'))
    await expect(api.getStatus('/nope')).rejects.toThrow('not a repo')
  })
})
