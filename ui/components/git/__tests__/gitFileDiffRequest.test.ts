/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'

import { requestFileDiff, takePendingFileDiff } from '../gitFileDiffRequest'

describe('requestFileDiff', () => {
  // Regression: from the footer's branch popup the Git view is not mounted, so the open-file-diff
  // event alone was dropped. The request now opens the view and waits for it.
  it('opens the Git view and parks the request until the view takes it', () => {
    const openGit = vi.fn()
    const openDiff = vi.fn()
    window.addEventListener('omniterm:open-git', openGit)
    window.addEventListener('omniterm:open-file-diff', openDiff)

    requestFileDiff({ path: 'src/a.ts', targetBranch: 'main' })

    expect(openGit).toHaveBeenCalledTimes(1)
    expect((openDiff.mock.calls[0][0] as CustomEvent).detail).toEqual({ path: 'src/a.ts', targetBranch: 'main' })
    expect(takePendingFileDiff()).toEqual({ path: 'src/a.ts', targetBranch: 'main' })
    expect(takePendingFileDiff()).toBeNull()
    window.removeEventListener('omniterm:open-git', openGit)
    window.removeEventListener('omniterm:open-file-diff', openDiff)
  })
})
