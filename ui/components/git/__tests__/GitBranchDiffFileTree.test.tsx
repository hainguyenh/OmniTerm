/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GitBranchDiffFileTree } from '../GitBranchDiffFileTree'
import type { GitFileChange } from '../gitTypes'

const change = (path: string, staged: GitFileChange['staged'] = 'modified'): GitFileChange => ({
  path, staged, unstaged: 'unmodified', is_conflicted: false,
})

describe('GitBranchDiffFileTree', () => {
  it('groups the compared files by folder and opens a file by its full path', () => {
    const onOpenFile = vi.fn()
    render(
      <GitBranchDiffFileTree
        files={[change('ui/git/a.ts', 'added'), change('ui/git/b.ts'), change('ui/c.ts'), change('README.md')]}
        onOpenFile={onOpenFile}
      />,
    )
    const ui = screen.getByRole('group', { name: 'ui' })
    expect(within(ui).getByRole('button', { name: /^ui/ })).toHaveTextContent('3')
    const nested = within(ui).getByRole('group', { name: 'ui/git' })
    expect(within(nested).getByText('a.ts').nextElementSibling).toHaveTextContent('A')
    expect(screen.getByText('README.md')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'View diff for ui/git/b.ts' }))
    expect(onOpenFile).toHaveBeenCalledWith('ui/git/b.ts')
  })

  it('collapses and expands a folder', () => {
    render(<GitBranchDiffFileTree files={[change('src/a.ts'), change('src/b.ts')]} onOpenFile={vi.fn()} />)
    const toggle = screen.getByRole('button', { name: /^src/ })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('a.ts')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText('a.ts')).toBeInTheDocument()
  })
})
