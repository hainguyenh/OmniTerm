/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EditorShortcutsSettings } from '../EditorShortcutsSettings'
import { DEFAULT_EDITOR_SHORTCUTS } from '../editor/editorShortcuts'

function mockOmnitermAPI() {
  window.omnitermAPI = {
    settings: {
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue({}),
    },
  } as unknown as typeof window.omnitermAPI
}

const baseSettings: AppSettings = {
  themeId: 'default',
  fontSize: 13,
  smartColors: false,
  checkUpdatesOnStartup: false,
  darkMode: true,
}

describe('EditorShortcutsSettings', () => {
  beforeEach(() => {
    mockOmnitermAPI()
  })

  it('renders all folding and search shortcuts with default values', () => {
    const setAppSettings = vi.fn()
    render(
      <EditorShortcutsSettings
        appSettings={baseSettings}
        setAppSettings={setAppSettings}
      />,
    )

    expect(screen.getByText('Editor Shortcuts')).toBeInTheDocument()
    expect(screen.getByText('Code Folding')).toBeInTheDocument()
    expect(screen.getByText('Search & Navigation')).toBeInTheDocument()

    // Folding rows
    expect(screen.getByText('Fold Level 1')).toBeInTheDocument()
    expect(screen.getByText('Fold Level 2')).toBeInTheDocument()
    expect(screen.getByText('Fold Level 5')).toBeInTheDocument()
    expect(screen.getByText('Fold All (Collapse All)')).toBeInTheDocument()
    expect(screen.getByText('Unfold All (Expand All)')).toBeInTheDocument()

    // Navigation rows
    expect(screen.getByText('Search Global (Search Everywhere)')).toBeInTheDocument()
    expect(screen.getByText('Search in File (Find)')).toBeInTheDocument()

    // Default keycaps
    expect(screen.getByText(DEFAULT_EDITOR_SHORTCUTS.foldLevel1)).toBeInTheDocument()
    expect(screen.getByText(DEFAULT_EDITOR_SHORTCUTS.foldAll)).toBeInTheDocument()
    expect(screen.getByText(DEFAULT_EDITOR_SHORTCUTS.unfoldAll)).toBeInTheDocument()
  })

  it('allows recording a new hotkey and saving to settings', () => {
    const setAppSettings = vi.fn()
    render(
      <EditorShortcutsSettings
        appSettings={baseSettings}
        setAppSettings={setAppSettings}
      />,
    )

    // Click record button for Fold Level 1
    const fold1Btn = screen.getByText(DEFAULT_EDITOR_SHORTCUTS.foldLevel1)
    fireEvent.click(fold1Btn)
    expect(screen.getByText('Recording…')).toBeInTheDocument()

    // Press Alt + 1
    fireEvent.keyDown(window, { key: '1', altKey: true })

    expect(setAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        editorShortcuts: expect.objectContaining({
          foldLevel1: 'Alt+1',
        }),
      }),
    )
    expect(window.omnitermAPI.settings.save).toHaveBeenCalled()
  })

  it('cancels recording on Escape key', () => {
    const setAppSettings = vi.fn()
    render(
      <EditorShortcutsSettings
        appSettings={baseSettings}
        setAppSettings={setAppSettings}
      />,
    )

    const foldAllBtn = screen.getByText(DEFAULT_EDITOR_SHORTCUTS.foldAll)
    fireEvent.click(foldAllBtn)
    expect(screen.getByText('Recording…')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('Recording…')).not.toBeInTheDocument()
    expect(setAppSettings).not.toHaveBeenCalled()
  })

  it('warns when attempting to assign reserved Ctrl+R shortcut', () => {
    const setAppSettings = vi.fn()
    const showAlert = vi.fn()
    render(
      <EditorShortcutsSettings
        appSettings={baseSettings}
        setAppSettings={setAppSettings}
        showAlert={showAlert}
      />,
    )

    const foldAllBtn = screen.getByText(DEFAULT_EDITOR_SHORTCUTS.foldAll)
    fireEvent.click(foldAllBtn)
    expect(screen.getByText('Recording…')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'r', ctrlKey: true })
    expect(showAlert).toHaveBeenCalledWith(
      expect.stringContaining('Chromium shortcuts'),
      expect.anything(),
    )
    expect(setAppSettings).not.toHaveBeenCalled()
  })

  it('resets editor shortcuts to defaults when clicking Reset', () => {
    const setAppSettings = vi.fn()
    render(
      <EditorShortcutsSettings
        appSettings={{
          ...baseSettings,
          editorShortcuts: { foldLevel1: 'Alt+1' },
        }}
        setAppSettings={setAppSettings}
      />,
    )

    const resetBtn = screen.getByText('Reset')
    fireEvent.click(resetBtn)

    expect(setAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        editorShortcuts: DEFAULT_EDITOR_SHORTCUTS,
      }),
    )
    expect(window.omnitermAPI.settings.save).toHaveBeenCalledWith({
      editorShortcuts: DEFAULT_EDITOR_SHORTCUTS,
      editorShortcutsDisabled: [],
    })
  })

  it('re-enables every switched-off shortcut when clicking Reset', () => {
    const setAppSettings = vi.fn()
    render(
      <EditorShortcutsSettings
        appSettings={{ ...baseSettings, editorShortcutsDisabled: ['searchGlobal'] }}
        setAppSettings={setAppSettings}
      />,
    )

    fireEvent.click(screen.getByText('Reset'))

    expect(setAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ editorShortcutsDisabled: [] }),
    )
  })

  it('shows every shortcut switched on by default', () => {
    render(<EditorShortcutsSettings appSettings={baseSettings} setAppSettings={vi.fn()} />)

    const toggles = screen.getAllByRole('switch')
    expect(toggles).toHaveLength(Object.keys(DEFAULT_EDITOR_SHORTCUTS).length)
    for (const toggle of toggles) expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('switches a shortcut off and persists it', () => {
    const setAppSettings = vi.fn()
    render(<EditorShortcutsSettings appSettings={baseSettings} setAppSettings={setAppSettings} />)

    fireEvent.click(screen.getByTestId('editor-shortcut-toggle-searchGlobal'))

    expect(setAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ editorShortcutsDisabled: ['searchGlobal'] }),
    )
    expect(window.omnitermAPI.settings.save).toHaveBeenCalledWith({
      editorShortcutsDisabled: ['searchGlobal'],
    })
  })

  it('switches a shortcut back on while keeping its binding', () => {
    const setAppSettings = vi.fn()
    render(
      <EditorShortcutsSettings
        appSettings={{
          ...baseSettings,
          editorShortcuts: { searchGlobal: 'Ctrl+Shift+F' },
          editorShortcutsDisabled: ['searchGlobal', 'searchFile'],
        }}
        setAppSettings={setAppSettings}
      />,
    )

    const toggle = screen.getByTestId('editor-shortcut-toggle-searchGlobal')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('Ctrl+Shift+F')).toBeInTheDocument()

    fireEvent.click(toggle)

    expect(setAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        editorShortcuts: { searchGlobal: 'Ctrl+Shift+F' },
        editorShortcutsDisabled: ['searchFile'],
      }),
    )
  })
})
