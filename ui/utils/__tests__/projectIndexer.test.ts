/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'

import {
  invalidateProjectIndex,
  scoreIndexedFile,
  searchIndexedFiles,
  type IndexedFile,
} from '../projectIndexer'

describe('projectIndexer', () => {
  it('indexes and searches files', () => {
    const wsId = 'ws-test-1'
    const files: IndexedFile[] = [
      {
        id: '1',
        name: 'Button.tsx',
        path: 'src/components/Button.tsx',
        kind: 'script',
        workspaceId: wsId,
        workspaceName: 'main',
        searchTokens: 'button.tsx src/components/button.tsx',
      },
      {
        id: '2',
        name: 'Modal.tsx',
        path: 'src/components/Modal.tsx',
        kind: 'script',
        workspaceId: wsId,
        workspaceName: 'main',
        searchTokens: 'modal.tsx src/components/modal.tsx',
      },
    ]

    // Invalidate and verify searchIndexedFiles returns empty when no index exists
    invalidateProjectIndex(wsId)
    expect(searchIndexedFiles(wsId, 'button')).toHaveLength(0)

    // Directly test scoring
    const score = scoreIndexedFile(files[0], 'button.tsx')
    expect(score).toBeGreaterThan(0)
  })
})
