/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const vcsCommit = vi.hoisted(() => vi.fn())
const notify = vi.hoisted(() => vi.fn())
const refreshNow = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('../../../ide/platform/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../ide/platform/ipc')>()),
  call: (result: Promise<unknown>) => result,
  commands: { vcsCommit },
}))
vi.mock('../../../ide/workbench/contributions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../ide/workbench/contributions')>()),
  notifications: () => ({ notify }),
  editorService: () => ({ openFile: vi.fn() }),
}))
vi.mock('../../../ide/features/vcs/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../ide/features/vcs/store')>()
  return { ...actual, refreshNow }
})

import type { FileStatus } from '../../../ide/platform/ipc'
import { useVcs } from '../../../ide/features/vcs/store'
import { buildScmSections, changeLetter, committablePaths } from '../scmModel'
import { ScmToolWindow } from '../ScmToolWindow'
import { useScmDrafts } from '../scmStore'

const file = (path: string, rel: string, unstaged: FileStatus['unstaged'], staged: FileStatus['staged'] = null): FileStatus =>
  ({ path, relPath: rel, unstaged, staged, renamedFrom: null }) as FileStatus

const roots = ['D:/w/aevra', 'D:/w/aevra/desktop', 'D:/w/know']
const status = [
  file('D:/w/aevra/a.ts', 'a.ts', 'modified'),
  file('D:/w/aevra/desktop/src/b.ts', 'src/b.ts', 'untracked'),
  file('D:/w/know/c.py', 'c.py', null, 'added'),
  file('D:/w/know/.cache', '.cache', 'ignored'),
  file('D:/w/know/m.txt', 'm.txt', 'conflicted'),
]

describe('buildScmSections', () => {
  it('gives each project its own branch and changes; the innermost repository owns a file', () => {
    const sections = buildScmSections(roots, { 'D:/w/aevra': { head: 'main' }, 'D:/w/know': { head: 'fix/x' } }, { 'D:/w/know': 'merge' }, status)
    expect(sections.map((s) => [s.name, s.branch, s.operation, s.changes.map((c) => c.relPath)])).toEqual([
      ['aevra', 'main', null, ['a.ts']],
      ['desktop', null, null, ['src/b.ts']],
      ['know', 'fix/x', 'merge', ['c.py', 'm.txt']],
    ])
    expect(sections[1]?.changes[0]).toMatchObject({ name: 'b.ts', dir: 'src', letter: 'U' })
  })

  it('keeps a repository without changes, and never commits conflicted files', () => {
    const sections = buildScmSections(roots, {}, {}, status)
    expect(buildScmSections(['D:/w/clean'], {}, {}, status)[0]?.changes).toEqual([])
    expect(committablePaths(sections[2]!)).toEqual(['D:/w/know/c.py'])
    expect(changeLetter('deleted')).toBe('D')
  })
})

describe('ScmToolWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    act(() => {
      useScmDrafts.setState({ messages: {}, folded: {}, busy: null })
      useVcs.setState({ roots, heads: { 'D:/w/aevra': { head: 'main', headCommit: null }, 'D:/w/know': { head: 'dev', headCommit: null } }, operations: {}, status })
    })
  })

  it('lists a section per project with branch (dirty marked) and change count', () => {
    render(<ScmToolWindow />)
    expect(screen.getAllByTestId('scm-section')).toHaveLength(3)
    expect(screen.getAllByTestId('scm-branch').map((b) => b.textContent)).toEqual(['main*', 'detached*', 'dev*'])
    expect(screen.getAllByTestId('scm-count').map((c) => c.textContent)).toEqual(['1', '1', '2'])
  })

  it('commits only the project whose message was typed, then clears it', async () => {
    vcsCommit.mockResolvedValue('abc')
    render(<ScmToolWindow />)
    const commit = screen.getAllByTestId('scm-commit') as HTMLButtonElement[]
    expect(commit.every((b) => b.disabled)).toBe(true)
    fireEvent.change(screen.getByLabelText('Commit message for aevra'), { target: { value: ' Fix login ' } })
    expect(commit[0]!.disabled).toBe(false)
    fireEvent.click(commit[0]!)
    await waitFor(() => expect(vcsCommit).toHaveBeenCalledTimes(1))
    expect(vcsCommit).toHaveBeenCalledWith('D:/w/aevra', 'Fix login', expect.objectContaining({ stage: ['D:/w/aevra/a.ts'], amend: false }))
    await waitFor(() => expect(refreshNow).toHaveBeenCalled())
    expect(useScmDrafts.getState().messages['D:/w/aevra']).toBe('')
  })

  it('commits with Ctrl+Enter and reports a failed commit without losing the message', async () => {
    vcsCommit.mockRejectedValue(new Error('hook failed'))
    render(<ScmToolWindow />)
    const box = screen.getByLabelText('Commit message for know')
    fireEvent.change(box, { target: { value: 'Add parser' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', body: 'hook failed' })))
    expect(useScmDrafts.getState().messages['D:/w/know']).toBe('Add parser')
  })

  it('says so when no project is a git repository', () => {
    act(() => useVcs.setState({ roots: [], status: [] }))
    render(<ScmToolWindow />)
    expect(screen.getByTestId('scm-empty')).toBeTruthy()
  })
})
