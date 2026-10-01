/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mockOmnitermAPI } from '../../testUtils'
import { resetPanePresenceForTests, setPanePresence } from '../../utils/agentPresenceStore'
import { subscribeOpen } from '../../utils/pastedImageStore'
import { recordPastedImage, recordSavedAttachments, releaseSessionMedia } from '../../utils/sessionAttachmentStore'
import { AttachmentsFooterButton } from '../AttachmentsFooterButton'

const openInSystem = vi.fn(async () => {})

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:thumb')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  openInSystem.mockClear()
  mockOmnitermAPI({ app: { openInSystem } })
})

afterEach(() => {
  act(() => {
    releaseSessionMedia('s1')
    resetPanePresenceForTests()
  })
  vi.restoreAllMocks()
})

describe('AttachmentsFooterButton', () => {
  it('stays hidden on a plain shell pane until something is attached', () => {
    render(<AttachmentsFooterButton sessionId="s1" />)
    expect(screen.queryByRole('button', { name: /Attachments/ })).toBeNull()
    act(() => {
      recordSavedAttachments('s1', [{ info: { name: 'notes-1.txt', path: 'C:/a/notes-1.txt', size: 2048, modifiedMs: 1, kind: 'file' } }])
    })
    expect(screen.getByRole('button', { name: 'Attachments (1)' })).toBeInTheDocument()
  })

  it('shows on an agent pane with an empty-state hint and opens the attachments folder', async () => {
    act(() => setPanePresence({ s1: { agent: 'claude', profileName: 'claude-work', pid: 1, startTime: 1 } }))
    render(<AttachmentsFooterButton sessionId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Attachments' }))
    const popover = screen.getByRole('dialog', { name: 'Attachments in this pane' })
    expect(within(popover).getByText(/drop images and files here/)).toBeInTheDocument()
    fireEvent.click(within(popover).getByRole('button', { name: /Open attachments folder/ }))
    await waitFor(() => expect(openInSystem).toHaveBeenCalledWith('C:/data/attachments'))
  })

  it('lists images (viewable, with a thumbnail) and files, newest first; only safe types open', () => {
    render(<AttachmentsFooterButton sessionId="s1" />)
    act(() => {
      recordPastedImage('s1', { bytes: new Uint8Array([1, 2, 3]), path: 'C:/a/paste-1.png' }, 1_000)
      recordSavedAttachments('s1', [
        { info: { name: 'report-2.pdf', path: 'C:/a/report-2.pdf', size: 3 * 1024 * 1024, modifiedMs: 2, kind: 'file' } },
        { info: { name: 'setup-3.exe', path: 'C:/a/setup-3.exe', size: 10, modifiedMs: 3, kind: 'file' } },
      ], 2_000)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Attachments (3)' }))
    const rows = screen.getAllByTestId('attachment-row')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('setup-3.exe'),
      expect.stringContaining('report-2.pdf'),
      expect.stringContaining('paste-1.png'),
    ])
    expect(within(rows[1]).getByText(/3\.0 MB/)).toBeInTheDocument()
    expect(rows[2].querySelector('img')).toHaveAttribute('src', 'blob:thumb')
    expect(within(rows[0]).queryByRole('button', { name: /Open/ })).toBeNull()

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Open report-2.pdf' }))
    expect(openInSystem).toHaveBeenCalledWith('C:/a/report-2.pdf')

    const onOpen = vi.fn()
    const unsubscribe = subscribeOpen('s1', onOpen)
    fireEvent.click(within(rows[2]).getByRole('button', { name: 'View paste-1.png' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('closes on Escape', () => {
    act(() => setPanePresence({ s1: { agent: 'claude', profileName: 'default', pid: 1, startTime: 1 } }))
    render(<AttachmentsFooterButton sessionId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Attachments' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Attachments in this pane' })).toBeNull()
  })

  it('allows attaching files via the Attach files button and file picker', async () => {
    const localInput = vi.fn()
    mockOmnitermAPI({
      app: { openInSystem },
      attachments: {
        save: vi.fn(async (name: string, bytes: Uint8Array) => ({
          name,
          path: `C:/data/attachments/${name}`,
          size: bytes.length,
          modifiedMs: Date.now(),
          kind: 'file' as const,
        })),
        list: vi.fn(async () => ({ dir: 'C:/data/attachments', files: [] })),
      },
      connect: { localInput },
    })
    act(() => setPanePresence({ s1: { agent: 'agy', profileName: 'agy', pid: 1, startTime: 1 } }))
    render(<AttachmentsFooterButton sessionId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Attachments' }))
    const attachBtn = screen.getByRole('button', { name: /Attach files/ })
    expect(attachBtn).toBeInTheDocument()
    const input = screen.getByTestId('attachment-file-input')
    const file = new File(['hello'], 'document.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      expect(localInput).toHaveBeenCalledWith('s1', 'C:/data/attachments/document.pdf')
    })
  })
})
