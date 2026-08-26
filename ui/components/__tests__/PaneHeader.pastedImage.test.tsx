/**
 * @vitest-environment jsdom
 */
import React, { createRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import PaneHeader from '../PaneHeader'
import { releasePastedImage, setLastPastedImage, subscribeOpen } from '../../utils/pastedImageStore'

const ssh: Connection = { id: 'ssh', name: 'SSH Server', type: 'SSH', host: 'host', port: '22', user: 'me' }

function setup(sessionId: string | null) {
  const props: React.ComponentProps<typeof PaneHeader> = {
    paneIndex: 1, conn: ssh, focused: false, sessionId, tabs: [], panes: [sessionId, null, null],
    layoutMode: 3, statuses: {}, connType: () => 'SSH', pickerOpen: false,
    pickerRef: createRef<HTMLDivElement>(), detach: null, onToggleDetach: vi.fn(),
    onFocus: vi.fn(), onDragStart: vi.fn(), onDragEnd: vi.fn(), onTogglePicker: vi.fn(),
    onAssign: vi.fn(), onClear: vi.fn(),
  }
  return render(<PaneHeader {...props} />)
}

describe('PaneHeader pasted-image button', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock-image')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    act(() => { releasePastedImage('sess-1') })
  })

  it('hides the button until this pane has a pasted image, then opens the viewer on click', () => {
    const view = setup('sess-1')
    expect(screen.queryByLabelText('View last pasted image')).toBeNull()

    act(() => { setLastPastedImage('sess-1', { bytes: new Uint8Array([1]), path: 'C:/temp/a.png' }) })
    const button = screen.getByLabelText('View last pasted image')

    const onOpen = vi.fn()
    const unsubscribe = subscribeOpen('sess-1', onOpen)
    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
    unsubscribe()
    view.unmount()
  })

  it('stays hidden for another session\u2019s image and for empty panes', () => {
    act(() => { setLastPastedImage('sess-2', { bytes: new Uint8Array([1]), path: 'C:/temp/b.png' }) })
    const withOtherSession = setup('sess-1')
    expect(screen.queryByLabelText('View last pasted image')).toBeNull()
    withOtherSession.unmount()

    setup(null)
    expect(screen.queryByLabelText('View last pasted image')).toBeNull()
  })
})
