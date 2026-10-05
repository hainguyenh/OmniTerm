/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTempNotes } from '../useTempNotes'
import { mockOmnitermAPI } from '../../testUtils'

describe('useTempNotes', () => {
  beforeEach(() => {
    mockOmnitermAPI({
      tempNotes: {
        write: vi.fn().mockResolvedValue({ id: 'note-1', title: '', mtime_ms: 1000, size: 0 }),
      },
    })
  })

  it('opens a temp tab and calls showTab', () => {
    const setActiveTabs = vi.fn()
    const setEditorTabs = vi.fn()
    const showTab = vi.fn()

    const { result } = renderHook(() =>
      useTempNotes({
        activeTabs: [],
        setActiveTabs,
        setEditorTabs,
        showTab,
      }),
    )

    act(() => {
      result.current.openTempTab('note-123', 'My Sticky Note')
    })

    expect(setEditorTabs).toHaveBeenCalled()
    expect(setActiveTabs).toHaveBeenCalled()
    expect(showTab).toHaveBeenCalledWith('temp:note-123', { autoFillOnly: true, newTab: true })
  })

  it('handles omniterm:new-temp-note event', async () => {
    const setActiveTabs = vi.fn()
    const setEditorTabs = vi.fn()
    const showTab = vi.fn()

    renderHook(() =>
      useTempNotes({
        activeTabs: [],
        setActiveTabs,
        setEditorTabs,
        showTab,
      }),
    )

    await act(async () => {
      window.dispatchEvent(new CustomEvent('omniterm:new-temp-note'))
    })

    expect(window.omnitermAPI.tempNotes.write).toHaveBeenCalled()
    expect(showTab).toHaveBeenCalledWith(expect.stringMatching(/^temp:note-/), { autoFillOnly: true, newTab: true })
  })
})
