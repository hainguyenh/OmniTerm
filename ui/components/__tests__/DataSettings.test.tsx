/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DataSettings from '../DataSettings'
import { mockOmnitermAPI } from '../../testUtils'

describe('DataSettings', () => {
  let importAll: ReturnType<typeof vi.fn>
  let exportAll: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    importAll = vi.fn().mockResolvedValue({ imported: { appSettings: 1 } })
    exportAll = vi.fn(async () => ({
      version: 1,
      exportedAt: '2026-08-24T00:00:00Z',
      sections: { appSettings: {}, connections: { connections: [], folders: [] }, themes: [], workspaces: [] },
    }))
    mockOmnitermAPI({
      settings: {
        exportAll,
        importAll,
      },
    })
  })

  it('renders data and backup section', () => {
    render(<DataSettings showAlert={vi.fn()} />)
    expect(screen.getByText('Data & Backup')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /import/i })).toBeInTheDocument()
  })

  it('handles settings export', async () => {
    let capturedBlob: Blob | undefined
    URL.createObjectURL = vi.fn(((blob: Blob) => { capturedBlob = blob; return 'blob:x' }) as typeof URL.createObjectURL)
    URL.revokeObjectURL = vi.fn()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const showAlert = vi.fn()
    render(<DataSettings showAlert={showAlert} />)

    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    await waitFor(() => {
      expect(exportAll).toHaveBeenCalled()
    })

    expect(clickSpy).toHaveBeenCalled()
    const written = JSON.parse(await (capturedBlob as Blob).text())
    expect(written.version).toBe(1)
    clickSpy.mockRestore()
  })

  it('handles settings backup import with replace strategy', async () => {
    const showAlert = vi.fn()
    render(<DataSettings showAlert={showAlert} />)

    const envelope = {
      version: 1,
      exportedAt: '2026-08-24T00:00:00Z',
      sections: { appSettings: {} },
    }
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([JSON.stringify(envelope)], 'backup.json', { type: 'application/json' })
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })

    expect(importAll).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }))

    await waitFor(() => expect(importAll).toHaveBeenCalledTimes(1))
    const [sentEnvelope, strategy] = importAll.mock.calls[0]
    expect(strategy).toBe('replace')
    expect((sentEnvelope as { sections: Record<string, unknown> }).sections).toEqual({ appSettings: {} })
    expect(screen.queryByRole('button', { name: 'Merge' })).not.toBeInTheDocument()
  })
})
