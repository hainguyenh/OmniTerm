/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    await waitFor(() => expect(screen.getByTitle('Show the file types the app always excludes')).toBeInTheDocument())
    fireEvent.click(screen.getByTitle('Show the file types the app always excludes'))
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
    fireEvent.click(screen.getByTitle('Add extension'))
    expect(setAppSettings).not.toHaveBeenCalled()
  })

  it('adds normalized custom exclusions and removes an existing one', async () => {
    const setAppSettings = vi.fn()
    render(<GeneralSettings appSettings={{ excludedViewableExts: ['md'] }} setAppSettings={setAppSettings} shellOptions={shells} onCloseSettings={vi.fn()} />)
    await waitFor(() => expect(window.omnitermAPI.settings.systemExcludedViewExts).toHaveBeenCalled())
    const input = screen.getByPlaceholderText(/Type an extension/)
    fireEvent.change(input, { target: { value: ' .RST ' } })
    fireEvent.click(screen.getByTitle('Add extension'))
    expect(setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ excludedViewableExts: ['md', 'rst'] }))
    expect(input).toHaveValue('')
    fireEvent.click(screen.getByTitle('Stop excluding .md'))
    expect(window.omnitermAPI.settings.save).toHaveBeenLastCalledWith({ excludedViewableExts: [] })
  })
})
