/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mockOmnitermAPI } from '../../testUtils'
import { resetPanePresenceForTests, setPanePresence } from '../agentPresenceStore'
import { attachmentFolderFor, moveToSessionFolder } from '../attachmentFolder'
import { getPastedImages } from '../pastedImageStore'
import { getSessionAttachments, recordPastedImage, recordSavedAttachments, releaseSessionMedia } from '../sessionAttachmentStore'

const pane = { agent: 'claude' as const, profileName: 'claude', pid: 1, startTime: 1 }

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:thumb')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  releaseSessionMedia('p1')
  resetPanePresenceForTests()
  vi.restoreAllMocks()
})

describe('attachmentFolderFor', () => {
  it('uses the pane while the agent has no session id, then the agent session id', () => {
    expect(attachmentFolderFor('p1')).toBe('p1')
    setPanePresence({ p1: pane })
    expect(attachmentFolderFor('p1')).toBe('p1')
    setPanePresence({ p1: { ...pane, agentSessionId: 'latest' } })
    expect(attachmentFolderFor('p1')).toBe('p1')
    setPanePresence({ p1: { ...pane, agentSessionId: 'sess-1', claudeSessionId: 'sess-1' } })
    expect(attachmentFolderFor('p1')).toBe('sess-1')
  })

  it('passes an absent pane id through', () => {
    expect(attachmentFolderFor(undefined)).toBeUndefined()
  })
})

describe('moveToSessionFolder', () => {
  it('re-points the pane list and image previews at the moved files', async () => {
    const move = vi.fn(async () => [{ from: 'C:/a/p1/shot.png', to: 'C:/a/sess-1/shot.png' }])
    mockOmnitermAPI({ attachments: { move } })
    recordPastedImage('p1', { bytes: new Uint8Array([1]), path: 'C:/a/p1/shot.png' })
    recordSavedAttachments('p1', [{ info: { name: 'n.txt', path: 'C:/a/p1/n.txt', size: 1, modifiedMs: 1, kind: 'file' } }])

    await moveToSessionFolder('p1', 'sess-1')

    expect(move).toHaveBeenCalledWith('p1', 'sess-1')
    expect(getSessionAttachments('p1').map((item) => item.path)).toEqual(['C:/a/sess-1/shot.png', 'C:/a/p1/n.txt'])
    expect(getSessionAttachments('p1')[0]?.name).toBe('shot.png')
    expect(getPastedImages('p1')[0]?.path).toBe('C:/a/sess-1/shot.png')
  })

  it('keeps the list when the move fails', async () => {
    mockOmnitermAPI({ attachments: { move: vi.fn(async () => { throw new Error('busy') }) } })
    recordSavedAttachments('p1', [{ info: { name: 'n.txt', path: 'C:/a/p1/n.txt', size: 1, modifiedMs: 1, kind: 'file' } }])
    await moveToSessionFolder('p1', 'sess-1')
    expect(getSessionAttachments('p1')[0]?.path).toBe('C:/a/p1/n.txt')
  })
})
