/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockOmnitermAPI } from '../../testUtils'
import GeneralSettings from '../GeneralSettings'

const shells = [{ id: 'powershell', label: 'PowerShell' }, { id: 'cmd', label: 'Command Prompt' }]

beforeEach(() => {
  mockOmnitermAPI({
    settings: { save: vi.fn(async () => {}), systemExcludedViewExts: vi.fn(async () => ['exe', 'dll']) },
    app: { revealLog: vi.fn(async () => '/tmp/log') },
  })
})

describe('GeneralSettings', () => {
  it('persists shell and clamps file-size values', async () => {
    const setAppSettings = vi.fn()
    const settings = { defaultShell: 'missing', maxOpenFileMb: 3, excludedViewableExts: [] }
    render(<GeneralSettings appSettings={settings} setAppSettings={setAppSettings} shellOptions={shells} onCloseSettings={vi.fn()} />)
    await waitFor(() => expect(window.omnitermAPI.settings.systemExcludedViewExts).toHaveBeenCalled())
    const shell = screen.getByLabelText('Default Terminal') as HTMLSelectElement
    expect(shell.value).toBe('powershell')
    fireEvent.change(shell, { target: { value: 'cmd' } })
    expect(setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ defaultShell: 'cmd' }))
    expect(window.omnitermAPI.settings.save).toHaveBeenCalledWith({ defaultShell: 'cmd' })

    const size = screen.getByLabelText('Max file size to open')
    fireEvent.change(size, { target: { value: '99' } })
    expect(window.omnitermAPI.settings.save).toHaveBeenLastCalledWith({ maxOpenFileMb: 25 })
    fireEvent.change(size, { target: { value: '-4' } })
    expect(window.omnitermAPI.settings.save).toHaveBeenLastCalledWith({ maxOpenFileMb: 1 })
    fireEvent.change(size, { target: { value: '' } })
    expect(window.omnitermAPI.settings.save).toHaveBeenLastCalledWith({ maxOpenFileMb: 1 })
  })

  it('shows locked exclusions, dismisses the list, and rejects duplicate or protected extensions', async () => {
    const setAppSettings = vi.fn()
    const { container } = render(<GeneralSettings appSettings={{ excludedViewableExts: ['log'] }} setAppSettings={setAppSettings} shellOptions={shells} onCloseSettings={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show system-locked excluded file types' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Show system-locked excluded file types' }))
    expect(screen.getByText('.exe')).toBeInTheDocument()
    expect(screen.getByText('.dll')).toBeInTheDocument()
    fireEvent.click(container.querySelector('.fixed.inset-0') as Element)
    expect(screen.queryByText('.exe')).not.toBeInTheDocument()

    const input = screen.getByPlaceholderText(/Type an extension/)
    fireEvent.change(input, { target: { value: '.EXE' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(setAppSettings).not.toHaveBeenCalled()
    expect(input).toHaveValue('')
    fireEvent.change(input, { target: { value: 'log' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add extension to exclude list' }))
    expect(setAppSettings).not.toHaveBeenCalled()
  })

  it('adds normalized custom exclusions and removes an existing one', async () => {
    const setAppSettings = vi.fn()
    render(<GeneralSettings appSettings={{ excludedViewableExts: ['md'] }} setAppSettings={setAppSettings} shellOptions={shells} onCloseSettings={vi.fn()} />)
    await waitFor(() => expect(window.omnitermAPI.settings.systemExcludedViewExts).toHaveBeenCalled())
    const input = screen.getByPlaceholderText(/Type an extension/)
    fireEvent.change(input, { target: { value: ' .RST ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add extension to exclude list' }))
    expect(setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ excludedViewableExts: ['md', 'rst'] }))
    expect(input).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Stop excluding .md' }))
    expect(window.omnitermAPI.settings.save).toHaveBeenLastCalledWith({ excludedViewableExts: [] })
  })

  it('persists the default workspace for new terminals as a structured setting', async () => {
    const setAppSettings = vi.fn()
    const workspaces = [
      { id: 'ws1', name: 'Alpha', folders: [{ id: 'f1', name: 'Core' }] },
      { id: 'ws2', name: 'Beta' },
    ]
    render(
      <GeneralSettings
        appSettings={{}}
        setAppSettings={setAppSettings}
        shellOptions={shells}
        workspaces={workspaces as never}
        onCloseSettings={vi.fn()}
      />,
    )
    await waitFor(() => expect(window.omnitermAPI.settings.systemExcludedViewExts).toHaveBeenCalled())

    const select = screen.getByLabelText('Default workspace for new terminals') as HTMLSelectElement
    expect(select.value).toBe('unset')

    // Folder selection encodes workspace + folder; the stored shape is the discriminated union.
    fireEvent.change(select, { target: { value: 'sel:ws1::f1' } })
    expect(setAppSettings).toHaveBeenCalledWith(expect.objectContaining({
      defaultWorkspace: { mode: 'folder', workspaceId: 'ws1', folderId: 'f1' },
    }))

    // A folder-less workspace stays plain workspace mode.
    fireEvent.change(select, { target: { value: 'sel:ws2' } })
    expect(setAppSettings).toHaveBeenCalledWith(expect.objectContaining({
      defaultWorkspace: { mode: 'workspace', workspaceId: 'ws2' },
    }))

    // Explicit home and back to unset both persist, so the chain is fully controllable.
    fireEvent.change(select, { target: { value: 'home' } })
    expect(setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ defaultWorkspace: { mode: 'home' } }))
    fireEvent.change(select, { target: { value: 'unset' } })
    expect(setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ defaultWorkspace: undefined }))
  })

  it('reflects a saved default-workspace setting back into the select value', () => {
    render(
      <GeneralSettings
        appSettings={{ defaultWorkspace: { mode: 'folder', workspaceId: 'ws1', folderId: 'f1' } }}
        setAppSettings={vi.fn()}
        shellOptions={shells}
        workspaces={[{ id: 'ws1', name: 'Alpha', folders: [{ id: 'f1', name: 'Core' }] }] as never}
        onCloseSettings={vi.fn()}
      />,
    )
    const select = screen.getByLabelText('Default workspace for new terminals') as HTMLSelectElement
    expect(select.value).toBe('sel:ws1::f1')
  })

  it('exports an envelope that carries the renderer persistence policies', async () => {
    const exportAll = vi.fn(async () => ({
      version: 1,
      exportedAt: '2026-08-24T00:00:00Z',
      sections: { appSettings: {}, connections: { connections: [], folders: [] }, themes: [], workspaces: [] },
    }))
    mockOmnitermAPI({
      settings: {
        save: vi.fn(async () => {}),
        systemExcludedViewExts: vi.fn(async () => []),
        exportAll,
        importAll: vi.fn(async () => ({ imported: {} })),
      },
    })
    localStorage.setItem('omniterm:terminal-persistence-policies', JSON.stringify({ tabA: 'keep-running' }))

    let capturedBlob: Blob | undefined
    URL.createObjectURL = vi.fn(((blob: Blob) => { capturedBlob = blob; return 'blob:x' }) as typeof URL.createObjectURL)
    URL.revokeObjectURL = vi.fn()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(
      <GeneralSettings
        appSettings={{}}
        setAppSettings={vi.fn()}
        shellOptions={shells}
        onCloseSettings={vi.fn()}
        showAlert={async () => {}}
      />,
    )
    await waitFor(() => expect(window.omnitermAPI.settings.systemExcludedViewExts).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Export settings/i }))

    await waitFor(() => expect(clickSpy).toHaveBeenCalled())
    const written = JSON.parse(await (capturedBlob as Blob).text())
    expect(written.version).toBe(1)
    expect(written.sections.persistencePolicies).toEqual({ tabA: 'keep-running' })
    clickSpy.mockRestore()
  })

  it('imports through the chosen strategy and applies persistence policies', async () => {
    const importAll = vi.fn(
      async (_envelope: unknown, _strategy: 'merge' | 'replace') => ({ imported: { appSettings: 1, workspaces: 2 } }),
    )
    mockOmnitermAPI({
      settings: {
        save: vi.fn(async () => {}),
        systemExcludedViewExts: vi.fn(async () => []),
        exportAll: vi.fn(),
        importAll,
      },
    })

    render(
      <GeneralSettings
        appSettings={{}}
        setAppSettings={vi.fn()}
        shellOptions={shells}
        onCloseSettings={vi.fn()}
        showAlert={async () => {}}
      />,
    )
    await waitFor(() => expect(window.omnitermAPI.settings.systemExcludedViewExts).toHaveBeenCalled())

    const envelope = {
      version: 1,
      exportedAt: '2026-08-24T00:00:00Z',
      sections: {
        appSettings: {},
        persistencePolicies: { tabB: 'freeze-while-closed' },
      },
    }
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([JSON.stringify(envelope)], 'backup.json', { type: 'application/json' })
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })

    // Strategy choice appears before anything is sent.
    expect(importAll).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }))

    await waitFor(() => expect(importAll).toHaveBeenCalledTimes(1))
    const [sentEnvelope, strategy] = importAll.mock.calls[0]
    expect(strategy).toBe('replace')
    // Renderer-owned section stripped before the backend rejects it as unknown.
    expect((sentEnvelope as { sections: Record<string, unknown> }).sections.persistencePolicies).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('omniterm:terminal-persistence-policies') ?? '{}')).toEqual({ tabB: 'freeze-while-closed' })
    // Choice row retires after a decision.
    expect(screen.queryByRole('button', { name: 'Merge' })).not.toBeInTheDocument()
  })
})
