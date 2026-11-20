import { beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.fn()
vi.mock('../../ide/workbench/contributions', () => ({ notifications: () => ({ notify }) }))

import type { Workspace } from '../../domain'
import { reportSessionStartFailure, workspaceHolding } from '../sessionStart'

const workspaces: Workspace[] = [
  { id: 'w1', name: 'A', folders: [{ id: 'f', name: 'f', path: 'D:\\Work\\App\\' }], order: 0, pins: [] },
  { id: 'w2', name: 'B', folders: [], order: 1, pins: [] },
]

describe('workspaceHolding', () => {
  it('names the selected workspace when the cwd is a folder of it or inside one', () => {
    expect(workspaceHolding(workspaces, 'w1', 'd:/work/app')).toBe('w1')
    expect(workspaceHolding(workspaces, 'w1', 'D:\\Work\\App\\src')).toBe('w1')
  })

  // Regression: after the new-terminal menu picked a folder, the selection reads `w1::f`. Matched
  // as a workspace id it named none, the session went untagged, and a folder shared with another
  // workspace opened its terminal there: no tab appeared in the workspace it was started from.
  it('reads a folder selection as its workspace', () => {
    expect(workspaceHolding(workspaces, 'w1::f', 'D:/Work/App')).toBe('w1')
  })

  it('is null without a selection or cwd, for an unknown workspace, a sibling folder or another workspace', () => {
    expect(workspaceHolding(workspaces, null, 'D:/Work/App')).toBeNull()
    expect(workspaceHolding(workspaces, 'w1', undefined)).toBeNull()
    expect(workspaceHolding(workspaces, 'nope', 'D:/Work/App')).toBeNull()
    expect(workspaceHolding(workspaces, 'w1', 'D:/Work/Application')).toBeNull()
    expect(workspaceHolding(workspaces, 'w2', 'D:/Work/App')).toBeNull()
  })
})

describe('reportSessionStartFailure', () => {
  beforeEach(() => notify.mockClear())

  it('names the reason from an Error or a string, and stays generic otherwise', () => {
    reportSessionStartFailure(new Error('no shell'))
    reportSessionStartFailure('denied')
    reportSessionStartFailure(42)
    expect(notify.mock.calls.map(([n]) => n.title)).toEqual([
      'Could not start the session: no shell',
      'Could not start the session: denied',
      'Could not start the session.',
    ])
  })
})
