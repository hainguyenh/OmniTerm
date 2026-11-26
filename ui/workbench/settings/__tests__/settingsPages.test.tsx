/** @vitest-environment jsdom */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCustomArt } from '../../../hooks/useCustomArt'
import { notifyCustomArtChanged } from '../customArtSync'
import { comboFromKeyEvent } from '../keyCombo'
import { ShortcutsPage } from '../ShortcutsPage'
import { useAppSettings } from '../useAppSettings'

type Listener = (settings: unknown) => void

let stored: Record<string, unknown>
let listeners: Listener[]
const save = vi.fn((fields: Record<string, unknown>) => {
  stored = { ...stored, ...fields }
  listeners.forEach((l) => l(stored))
  return Promise.resolve()
})
const artGet = vi.fn(() => Promise.resolve(null))

beforeEach(() => {
  stored = { darkMode: true, shortcuts: { newSession: 'Ctrl+N' } }
  listeners = []
  ;(window as unknown as { omnitermAPI: unknown }).omnitermAPI = {
    settings: {
      get: vi.fn(() => Promise.resolve({ ...stored })),
      save,
      onChanged: (cb: Listener) => {
        listeners.push(cb)
        return () => { listeners = listeners.filter((l) => l !== cb) }
      },
    },
    customArt: { get: artGet },
  }
})
afterEach(() => vi.clearAllMocks())

describe('useAppSettings', () => {
  it('loads through omnitermAPI, saves patches and follows changes from other windows', async () => {
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.appSettings).toBeNull()
    await waitFor(() => expect(result.current.appSettings?.darkMode).toBe(true))

    act(() => result.current.patch({ darkMode: false }))
    expect(save).toHaveBeenCalledWith({ darkMode: false })
    expect(result.current.appSettings?.darkMode).toBe(false)

    stored = { ...stored, fontSize: 20 }
    act(() => listeners.forEach((l) => l(stored)))
    await waitFor(() => expect(result.current.appSettings?.fontSize).toBe(20))
  })

  it('unsubscribes on unmount', async () => {
    const { unmount, result } = renderHook(() => useAppSettings())
    await waitFor(() => expect(result.current.appSettings).not.toBeNull())
    unmount()
    expect(listeners).toHaveLength(0)
  })
})

describe('ShortcutsPage', () => {
  it('records a combo and saves it through omnitermAPI', async () => {
    render(<ShortcutsPage />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(save).toHaveBeenCalled())
    const saved = save.mock.calls[0]![0] as { shortcuts: Record<string, string> }
    expect(Object.values(saved.shortcuts)).toContain('Ctrl+Shift+K')
  })

  it('refuses the reserved Chromium shortcuts', async () => {
    render(<ShortcutsPage />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!)
    fireEvent.keyDown(window, { key: 'r', ctrlKey: true })
    expect(await screen.findByText(/native Chromium shortcuts/)).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
  })

  it('resets to the defaults', async () => {
    render(<ShortcutsPage />)
    const reset = await screen.findByRole('button', { name: /Reset/ })
    // Saving broadcasts the change, and the page reloads its settings from that broadcast.
    await act(async () => { fireEvent.click(reset) })
    const saved = save.mock.calls[0]![0] as { shortcuts: Record<string, string> }
    expect(saved.shortcuts.newSession).toBe('Ctrl+N')
    expect(saved.shortcuts.zoomIn).toBe('Ctrl+=')
  })
})

describe('comboFromKeyEvent', () => {
  it('spells modifiers and names the space key', () => {
    expect(comboFromKeyEvent({ key: ' ', ctrlKey: true, metaKey: false, shiftKey: false, altKey: true })).toBe('Ctrl+Alt+Space')
    expect(comboFromKeyEvent({ key: 'Shift', ctrlKey: false, metaKey: false, shiftKey: true, altKey: false })).toBeNull()
  })
})

describe('live broadcast to the main window', () => {
  it('refreshes the main window artwork when the Settings window bumps the revision', async () => {
    renderHook(() => useCustomArt(true))
    await waitFor(() => expect(artGet).toHaveBeenCalledTimes(4))
    notifyCustomArtChanged()
    expect(save).toHaveBeenCalledWith({ customArtRevision: expect.any(Number) })
    await waitFor(() => expect(artGet).toHaveBeenCalledTimes(8))
  })

  it('ignores settings changes that leave the revision alone', async () => {
    renderHook(() => useCustomArt(true))
    await waitFor(() => expect(artGet).toHaveBeenCalledTimes(4))
    act(() => listeners.forEach((l) => l({ fontSize: 15 })))
    expect(artGet).toHaveBeenCalledTimes(4)
  })
})
