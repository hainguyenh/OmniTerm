/**
 * @vitest-environment jsdom
 *
 * Where a quick "new session" pane's connection record comes from.
 *
 * Under Tauri only the backend may decide what gets spawned, so a pane has to be launched from a
 * record the backend itself registered. The renderer used to invent `local-default-<timestamp>`,
 * which resolved to nothing there: the pane reported `Unknown connection` and hung on "connecting".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openNewSession } from '../newSession'

function setBridge(shells: unknown): void {
  (window as any).omnitermAPI = { shells }
}

beforeEach(() => {
  delete (window as any).omnitermAPI
})

describe('openNewSession', () => {
  it('opens the record the backend registered, not one it made up', async () => {
    const record = { id: 'adhoc-7', name: 'PowerShell', type: 'LOCAL', shell: 'powershell' }
    const open = vi.fn().mockResolvedValue(record)
    setBridge({ open })
    const connected: unknown[] = []

    await openNewSession('powershell', (c) => connected.push(c))

    expect(open).toHaveBeenCalledWith('powershell', undefined)
    expect(connected).toEqual([record])
  })

  it('passes the selected workspace through to the backend', async () => {
    const open = vi.fn().mockResolvedValue({ id: 'adhoc-8', type: 'LOCAL' })
    setBridge({ open })
    await openNewSession('powershell', vi.fn(), 'ws#1')
    expect(open).toHaveBeenCalledWith('powershell', 'ws#1')
  })

  it('opens nothing when the backend returns no record', async () => {
    setBridge({ open: vi.fn().mockResolvedValue(null) })
    const onConnect = vi.fn()
    await openNewSession('powershell', onConnect)
    expect(onConnect).not.toHaveBeenCalled()
  })

  /** A refused shell must reach the caller: silently opening some other shell would be worse. */
  it('propagates a rejection from the backend', async () => {
    setBridge({ open: vi.fn().mockRejectedValue('Unsupported shell "calc.exe".') })
    await expect(openNewSession('calc.exe', vi.fn())).rejects.toContain('Unsupported shell')
  })

  it('fails loudly when the typed Tauri command is unavailable', async () => {
    setBridge({ ready: () => {} })
    await expect(openNewSession('cmd', vi.fn())).rejects.toThrow()
  })
})
