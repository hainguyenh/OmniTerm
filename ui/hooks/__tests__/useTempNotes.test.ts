/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const openInput = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../../ide/workbench/contributions', () => ({ editorService: () => ({ openInput }) }))

import { mockOmnitermAPI } from '../../testUtils'
import { useTempNotes } from '../useTempNotes'

describe('useTempNotes', () => {
  beforeEach(() => {
    openInput.mockClear()
    mockOmnitermAPI({
      tempNotes: {
        write: vi.fn().mockResolvedValue({ id: 'note-1', title: '', mtime_ms: 1000, size: 0 }),
      },
    })
  })

  it('opens a note as a `notes` editor tab', () => {
    const { result } = renderHook(() => useTempNotes())
    act(() => {
      result.current.openTempTab('note-123', 'My Sticky Note')
    })
    expect(openInput).toHaveBeenCalledWith(
      { kind: 'notes', key: 'notes:note-123', data: { noteId: 'note-123', title: 'My Sticky Note' } },
      { focus: true },
    )
  })

  it('handles omniterm:new-temp-note event', async () => {
    renderHook(() => useTempNotes())
    await act(async () => {
      window.dispatchEvent(new CustomEvent('omniterm:new-temp-note'))
    })
    expect(window.omnitermAPI.tempNotes.write).toHaveBeenCalled()
    expect(openInput).toHaveBeenCalledWith(expect.objectContaining({ kind: 'notes', key: expect.stringMatching(/^notes:note-/) }), { focus: true })
  })

  it('ignores an open-temp-tab event with a malformed id', () => {
    renderHook(() => useTempNotes())
    act(() => {
      window.dispatchEvent(new CustomEvent('omniterm:open-temp-tab', { detail: { id: '../etc/passwd' } }))
      window.dispatchEvent(new CustomEvent('omniterm:open-temp-tab', { detail: { id: 'note-9', title: 'Hi' } }))
    })
    expect(openInput).toHaveBeenCalledTimes(1)
    expect(openInput.mock.calls[0]![0].key).toBe('notes:note-9')
  })
})
