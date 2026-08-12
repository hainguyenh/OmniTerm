/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockOmnitermAPI } from '../../testUtils'
import { TOKYO_NIGHT, type AppTheme } from '../../themes'
import { ThemeRemixModal } from '../ThemeRemixModal'

const custom: AppTheme = {
  ...TOKYO_NIGHT,
  id: 'theme-custom',
  name: 'Custom Theme',
  terminal: {
    dark: { ...TOKYO_NIGHT.terminal.dark },
    light: { ...TOKYO_NIGHT.terminal.light },
  },
  ui: {
    dark: { ...TOKYO_NIGHT.ui.dark, borderRadiusMd: '0.5rem', paddingMd: '12px' },
    light: { ...TOKYO_NIGHT.ui.light, borderRadiusMd: '10px', paddingMd: '1rem' },
  },
}

const settings: AppSettings = {
  themeId: TOKYO_NIGHT.id,
  fontSize: 14,
  smartColors: true,
  checkUpdatesOnStartup: true,
  darkMode: true,
}

function setup(overrides: Partial<React.ComponentProps<typeof ThemeRemixModal>> = {}) {
  const saveTheme = vi.fn(async () => {})
  const deleteTheme = vi.fn(async () => {})
  const listThemes = vi.fn(async () => [TOKYO_NIGHT, custom])
  const openFolder = vi.fn(async () => {})
  const saveSettings = vi.fn(async () => {})
  mockOmnitermAPI({
    themes: { save: saveTheme, delete: deleteTheme, list: listThemes, openFolder },
    settings: { save: saveSettings },
  })
  const props: React.ComponentProps<typeof ThemeRemixModal> = {
    isOpen: true,
    onClose: vi.fn(),
    themes: [TOKYO_NIGHT, custom],
    setThemes: vi.fn(),
    appSettings: settings,
    setAppSettings: vi.fn(),
    currentTheme: TOKYO_NIGHT,
    ...overrides,
  }
  const view = render(<ThemeRemixModal {...props} />)
  return { ...view, props, saveTheme, deleteTheme, listThemes, openFolder, saveSettings }
}

const nameInput = () => screen.getByLabelText('Theme name') as HTMLInputElement

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(1234)
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
})
afterEach(() => vi.restoreAllMocks())

describe('ThemeRemixModal', () => {
  it('renders nothing while closed', () => {
    const x = setup({ isOpen: false })
    expect(screen.queryByText('Theme Remix')).not.toBeInTheDocument()
    x.unmount()
  })

  it('opens the JSON folder and reloads themes from disk', async () => {
    const x = setup()
    fireEvent.click(screen.getByTitle('Open themes folder'))
    fireEvent.click(screen.getByTitle('Reload themes from JSON files'))
    await waitFor(() => expect(x.openFolder).toHaveBeenCalledTimes(1))
    expect(x.listThemes).toHaveBeenCalled()
  })

  it('creates and duplicates a deep theme copy, selects it, and persists the app choice', async () => {
    const x = setup()
    fireEvent.click(screen.getByText('New Custom Theme'))
    await waitFor(() => expect(x.saveTheme).toHaveBeenCalled())
    expect((x.saveTheme.mock.calls as any)[0][0]).toMatchObject({ id: 'theme-1234-i', name: 'New Remix 2' })
    expect(x.props.setThemes).toHaveBeenCalledWith([TOKYO_NIGHT, custom])
    expect(x.props.setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ themeId: 'theme-1234-i' }))
    expect(x.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ themeId: 'theme-1234-i' }))

    fireEvent.click(screen.getAllByTitle('Duplicate')[1])
    await waitFor(() => expect(x.saveTheme).toHaveBeenCalledTimes(2))
    const copy = (x.saveTheme.mock.calls as any)[1][0]
    expect(copy).toMatchObject({ name: 'Custom Theme Copy' })
    expect(copy.terminal.dark).not.toBe(custom.terminal.dark)
    expect(copy.ui.dark).not.toBe(custom.ui.dark)
  })

  it('deletes custom themes, moves active settings to a fallback, and protects built-ins', async () => {
    const active = setup({ appSettings: { ...settings, themeId: custom.id } })
    fireEvent.click(screen.getByTitle('Delete'))
    await waitFor(() => expect(active.deleteTheme).toHaveBeenCalledWith(custom.id))
    expect(active.props.setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ themeId: TOKYO_NIGHT.id }))
    expect(active.saveSettings).toHaveBeenCalled()
    active.unmount()

    // A built-in has no delete affordance at all.
    const builtInOnly = setup({ themes: [TOKYO_NIGHT] })
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument()
    expect(builtInOnly.deleteTheme).not.toHaveBeenCalled()
    builtInOnly.unmount()

    // The last remaining theme is never deleted, even when it is a custom one.
    const singleCustom = setup({ themes: [custom], currentTheme: custom })
    fireEvent.click(screen.getByTitle('Delete'))
    expect(singleCustom.deleteTheme).not.toHaveBeenCalled()
  })

  it('applies another theme and disables apply for the current theme', async () => {
    const x = setup()
    expect(screen.getByText('Apply This Theme')).toBeDisabled()
    fireEvent.click(screen.getByText('Custom Theme'))
    expect(screen.getByText('Apply This Theme')).not.toBeDisabled()
    fireEvent.click(screen.getByText('Apply This Theme'))
    await waitFor(() => expect(x.props.setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ themeId: custom.id })))
    expect(x.saveSettings).toHaveBeenCalled()
  })

  it('keeps the selected theme highlighted and supports moving and resizing the review', () => {
    const x = setup()
    const selected = screen.getByText('Custom Theme').closest('div.group') as HTMLElement
    expect(selected).toHaveStyle({ backgroundColor: '' })
    fireEvent.click(screen.getByText('Custom Theme'))
    expect(screen.getByText('Custom Theme').closest('div.group')).toHaveStyle({ backgroundColor: 'var(--theme-hover-bg)' })

    const modal = screen.getByText('Theme Remix').closest('.relative') as HTMLElement
    const header = screen.getByText('Theme Remix').closest('div.border-b') as HTMLElement
    fireEvent.pointerDown(header, { clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 140, clientY: 130 })
    fireEvent.pointerUp(window)
    expect(modal.style.transform).toBe('translate(40px, 30px)')

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize Theme Remix' }), { clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 180, clientY: 160 })
    fireEvent.pointerUp(window)
    expect(modal.style.width).toBe('1280px')
    x.unmount()
  })

  it('keeps edits in the draft until Save is pressed', async () => {
    const x = setup()
    expect(screen.getByText('Save')).toBeDisabled()

    fireEvent.change(nameInput(), { target: { value: 'Renamed' } })
    fireEvent.change(screen.getByLabelText('Accent'), { target: { value: '#123456' } })
    fireEvent.change(screen.getByLabelText('Black'), { target: { value: '#010203' } })

    // Not one write so far — the old editor wrote the file on every keystroke.
    expect(x.saveTheme).not.toHaveBeenCalled()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(x.saveTheme).toHaveBeenCalledTimes(1))
    const saved = (x.saveTheme.mock.calls as any)[0][0]
    expect(saved.name).toBe('Renamed')
    expect(saved.ui.dark.accent).toBe('#123456')
    expect(saved.terminal.dark.black).toBe('#010203')
    expect(x.listThemes).toHaveBeenCalled()
  })

  it('reverts unsaved edits and guards the close button', () => {
    const onClose = vi.fn()
    const x = setup({ onClose })

    fireEvent.change(nameInput(), { target: { value: 'Throwaway' } })
    fireEvent.click(screen.getByText('Revert'))
    expect(nameInput().value).toBe(TOKYO_NIGHT.name)
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()

    // Clean close goes straight through.
    fireEvent.click(screen.getByTitle('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)

    // Dirty close asks first, and "Keep editing" cancels.
    fireEvent.change(nameInput(), { target: { value: 'Dirty' } })
    fireEvent.click(screen.getByTitle('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Keep editing'))
    expect(nameInput().value).toBe('Dirty')

    fireEvent.click(screen.getByTitle('Close'))
    fireEvent.click(screen.getByText('Discard changes'))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(nameInput().value).toBe(TOKYO_NIGHT.name)
    x.unmount()
  })

  it('resets a built-in by dropping the user override, and a custom theme to the default palette', async () => {
    const x = setup()
    fireEvent.change(screen.getByLabelText('Accent'), { target: { value: '#ff0000' } })
    fireEvent.click(screen.getByText('Reset to default'))
    await waitFor(() => expect(x.deleteTheme).toHaveBeenCalledWith(TOKYO_NIGHT.id))
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument())
    x.unmount()

    const customOnly = setup({ themes: [custom, TOKYO_NIGHT], currentTheme: custom })
    fireEvent.change(nameInput(), { target: { value: 'Custom Theme' } })
    fireEvent.change(screen.getByLabelText('Accent'), { target: { value: '#00ff00' } })
    fireEvent.click(screen.getByText('Reset to default'))
    await waitFor(() =>
      expect((screen.getByLabelText('Accent') as HTMLInputElement).value).toBe(TOKYO_NIGHT.ui.dark.accent))
    // A custom theme has no shipped file to restore, so nothing is deleted.
    expect(customOnly.deleteTheme).not.toHaveBeenCalled()
    expect(nameInput().value).toBe('Custom Theme')
  })

  it('edits the light variant, including the light-only ANSI black background', async () => {
    const x = setup()
    fireEvent.click(screen.getByTitle('Edit light variant'))
    fireEvent.change(screen.getByLabelText('Black background (light mode)'), { target: { value: '#eeeeee' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(x.saveTheme).toHaveBeenCalled())
    expect((x.saveTheme.mock.calls as any)[0][0].terminal.light.lightModeBlackBackground).toBe('#eeeeee')
  })

  it('converts rem and px sliders for both dark and light variants', async () => {
    const x = setup({ currentTheme: custom, themes: [custom] })
    fireEvent.change(screen.getByLabelText('Border radius'), { target: { value: '16' } })
    fireEvent.change(screen.getByLabelText('Padding and margins'), { target: { value: '20' } })
    fireEvent.click(screen.getByTitle('Edit light variant'))
    fireEvent.change(screen.getByLabelText('Border radius'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Padding and margins'), { target: { value: '24' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(x.saveTheme).toHaveBeenCalled())
    const saved = (x.saveTheme.mock.calls as any)[0][0] as AppTheme
    expect(saved.ui.dark.borderRadiusMd).toBe('1rem')
    expect(saved.ui.dark.paddingMd).toBe('20px')
    expect(saved.ui.light.borderRadiusMd).toBe('12px')
    expect(saved.ui.light.paddingMd).toBe('1.5rem')
  })

  it('accepts a non-hex colour such as the translucent hover fill through a text field', async () => {
    const x = setup()
    fireEvent.change(screen.getByLabelText('Hover fill'), { target: { value: 'rgba(9, 9, 9, 0.3)' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(x.saveTheme).toHaveBeenCalled())
    expect((x.saveTheme.mock.calls as any)[0][0].ui.dark.hoverBg).toBe('rgba(9, 9, 9, 0.3)')
  })

  it('previews both modes by default and narrows to one on request', () => {
    setup()
    expect(screen.getByTestId('theme-preview-dark')).toBeInTheDocument()
    expect(screen.getByTestId('theme-preview-light')).toBeInTheDocument()
    // The callouts naming what each row demonstrates.
    expect(screen.getAllByText(/←—— terminal/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/←—— hover \/ selected/).length).toBeGreaterThan(0)

    const modes = within(screen.getByRole('radiogroup', { name: 'Preview mode' }))
    fireEvent.click(modes.getByText('Light'))
    expect(screen.queryByTestId('theme-preview-dark')).not.toBeInTheDocument()
    expect(screen.getByTestId('theme-preview-light')).toBeInTheDocument()

    fireEvent.click(modes.getByText('Dark'))
    expect(screen.getByTestId('theme-preview-dark')).toBeInTheDocument()
    expect(screen.queryByTestId('theme-preview-light')).not.toBeInTheDocument()
  })

  it('previews the draft as it is typed, before anything is saved', () => {
    const x = setup()
    fireEvent.change(screen.getByLabelText('App background'), { target: { value: '#0b0c10' } })
    expect(screen.getByTestId('theme-preview-dark').style.getPropertyValue('--theme-bg')).toBe('#0b0c10')
    expect(x.saveTheme).not.toHaveBeenCalled()
  })

  it('routes Escape through the same unsaved-changes guard as the close button', () => {
    const onClose = vi.fn()
    const x = setup({ onClose })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.change(nameInput(), { target: { value: 'Dirty' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByText('This theme has unsaved changes.')).toBeInTheDocument()

    // While the prompt is up a second Escape must not re-trigger the guard behind it.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    x.unmount()
  })

  it('edits a theme that predates the ui block without offering spacing controls', () => {
    const legacy = {
      ...TOKYO_NIGHT,
      id: 'legacy',
      name: 'Legacy',
      ui: undefined as unknown as AppTheme['ui'],
    }
    setup({ themes: [legacy], currentTheme: legacy })

    expect(screen.getByText('App colors')).toBeInTheDocument()
    expect(screen.queryByText('Typography & spacing')).not.toBeInTheDocument()
    // The preview still dresses it from the legacy fallbacks rather than blanking out.
    expect(screen.getByTestId('theme-preview-dark').style.getPropertyValue('--theme-accent'))
      .toBe(TOKYO_NIGHT.terminal.dark.blue)
  })

  it('loads the selected theme into the editor and falls back to currentTheme when it disappears', () => {
    const x = setup()
    fireEvent.click(screen.getByText('Custom Theme'))
    expect(nameInput().value).toBe('Custom Theme')
    x.unmount()

    const orphan = setup({ currentTheme: custom, themes: [TOKYO_NIGHT] })
    expect(nameInput().value).toBe('Custom Theme')
    orphan.unmount()
  })
})
