/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AttachmentInfo } from '../../utils/attachmentTypes'
import { mockOmnitermAPI } from '../../testUtils'
import AttachmentsSettings from '../AttachmentsSettings'

const file = (name: string, size: number): AttachmentInfo => ({ name, path: `C:/data/attachments/${name}`, size, modifiedMs: 1, kind: 'file' })

let stored: AttachmentInfo[] = []
const list = vi.fn(async () => ({ dir: 'C:/data/attachments', files: stored }))
const clear = vi.fn(async () => {
  const report = { removed: stored.length, bytes: stored.reduce((sum, item) => sum + item.size, 0), failed: 0 }
  stored = []
  return report
})
const openInSystem = vi.fn(async () => {})

beforeEach(() => {
  stored = [file('a.pdf', 2 * 1024 * 1024), file('b.png', 512 * 1024)]
  list.mockClear()
  clear.mockClear()
  openInSystem.mockClear()
  mockOmnitermAPI({ attachments: { list, clear, save: vi.fn(), importClipboardFiles: vi.fn() }, app: { openInSystem } })
})

describe('AttachmentsSettings', () => {
  it('summarizes what is stored and opens the folder for review', async () => {
    render(<AttachmentsSettings />)
    await waitFor(() => expect(screen.getByTestId('attachments-summary')).toHaveTextContent('2 files · 2.5 MB stored'))
    fireEvent.click(screen.getByRole('button', { name: /Open folder/ }))
    expect(openInSystem).toHaveBeenCalledWith('C:/data/attachments')
  })

  it('clears only after confirmation, then reports the result and refreshes', async () => {
    render(<AttachmentsSettings />)
    await waitFor(() => expect(screen.getByTestId('attachments-summary')).toHaveTextContent('2 files'))

    fireEvent.click(screen.getByRole('button', { name: /Clear all/ }))
    const confirm = screen.getByRole('alertdialog', { name: 'Confirm clearing attachments' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(clear).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Clear all/ }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Deleted 2 files (2.5 MB).'))
    expect(clear).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.getByTestId('attachments-summary')).toHaveTextContent('0 files · 0 B stored'))
    expect(screen.getByRole('button', { name: /Clear all/ })).toBeDisabled()
  })

  it('keeps Clear disabled when nothing is stored', async () => {
    stored = []
    render(<AttachmentsSettings />)
    await waitFor(() => expect(screen.getByTestId('attachments-summary')).toHaveTextContent('0 files'))
    expect(screen.getByRole('button', { name: /Clear all/ })).toBeDisabled()
  })
})
