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
  const saveSettings = vi.fn(async () => {})
  mockOmnitermAPI({
    themes: { save: saveTheme, delete: deleteTheme, list: listThemes },
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
  return { ...view, props, saveTheme, deleteTheme, listThemes, saveSettings }
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(1234)
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
})
afterEach(() => vi.restoreAllMocks())

describe('ThemeRemixModal complete behavior', () => {
  it('creates and duplicates a deep theme copy, selects it, and persists the app choice', async () => {
    const x = setup()
    fireEvent.click(screen.getByText('New Custom Theme'))
    await waitFor(() => expect(x.saveTheme).toHaveBeenCalled())
    expect((x.saveTheme.mock.calls as any)[0][0]).toMatchObject({ id: 'theme-1234-i', name: 'New Remix 2' })
    expect(x.listThemes).toHaveBeenCalled()
    expect(x.props.setThemes).toHaveBeenCalledWith([TOKYO_NIGHT, custom])
    expect(x.props.setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ themeId: 'theme-1234-i' }))
    expect(x.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ themeId: 'theme-1234-i' }))

    fireEvent.click(screen.getByText('Custom Theme'))
    fireEvent.click(screen.getAllByTitle('Duplicate')[0])
    await waitFor(() => expect(x.saveTheme).toHaveBeenCalledTimes(2))
    expect((x.saveTheme.mock.calls as any)[1][0]).toMatchObject({ name: 'Custom Theme Copy' })
    expect((x.saveTheme.mock.calls as any)[1][0].terminal.dark).not.toBe(custom.terminal.dark)
    expect((x.saveTheme.mock.calls as any)[1][0].ui.dark).not.toBe(custom.ui.dark)
  })

  it('deletes custom themes, moves active settings to a fallback, and protects built-ins', async () => {
    const active = setup({ appSettings: { ...settings, themeId: custom.id } })
    fireEvent.click(screen.getByText('Custom Theme'))
    fireEvent.click(screen.getByTitle('Delete'))
    await waitFor(() => expect(active.deleteTheme).toHaveBeenCalledWith(custom.id))
    expect(active.props.setAppSettings).toHaveBeenCalledWith(expect.objectContaining({ themeId: TOKYO_NIGHT.id }))
    expect(active.saveSettings).toHaveBeenCalled()

    active.unmount()
    const builtInOnly = setup({ themes: [TOKYO_NIGHT] })
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument()
    expect(builtInOnly.deleteTheme).not.toHaveBeenCalled()
    builtInOnly.unmount()

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

  it('edits names, typography, terminal fonts, app colors, and dark terminal colors', async () => {
    const x = setup()
    fireEvent.click(screen.getByText('Custom Theme'))
    fireEvent.change(screen.getByDisplayValue('Custom Theme'), { target: { value: 'Renamed' } })
    const [typography, terminalFont] = screen.getAllByRole('combobox')
    fireEvent.change(typography, { target: { value: 'Georgia, "Times New Roman", serif' } })
    fireEvent.change(terminalFont, { target: { value: 'SF Mono, Menlo, Consolas, monospace' } })

    const appColor = screen.getByText('App Background').parentElement?.querySelector('input') as HTMLInputElement
    fireEvent.change(appColor, { target: { value: '#123456' } })
    fireEvent.click(screen.getByText('Terminal Palette'))
    const black = screen.getByText('black').parentElement?.querySelector('input') as HTMLInputElement
    fireEvent.change(black, { target: { value: '#010203' } })

    await waitFor(() => expect(x.saveTheme.mock.calls.length).toBeGreaterThanOrEqual(5))
    expect(x.props.setThemes).toHaveBeenCalled()
    expect((x.saveTheme.mock.calls as any).some(([t]: any) => t.name === 'Renamed')).toBe(true)
    expect((x.saveTheme.mock.calls as any).some(([t]: any) => t.terminal.dark.black === '#010203')).toBe(true)
  })

  it('converts rem and px sliders for both dark and light variants', async () => {
    const x = setup()
    fireEvent.click(screen.getByText('Custom Theme'))
    const ranges = screen.getAllByRole('slider')
    fireEvent.change(ranges[0], { target: { value: '16' } })
    fireEvent.change(ranges[1], { target: { value: '20' } })
    fireEvent.click(screen.getByTitle('Edit light variant'))
    const lightRanges = screen.getAllByRole('slider')
    fireEvent.change(lightRanges[0], { target: { value: '12' } })
    fireEvent.change(lightRanges[1], { target: { value: '24' } })

    await waitFor(() => expect(x.saveTheme.mock.calls.length).toBeGreaterThanOrEqual(16))
    const updates = (x.saveTheme.mock.calls as any).map(([theme]: any) => theme)
    expect(updates.some((t: AppTheme) => t.ui.dark.borderRadiusMd === '1rem')).toBe(true)
    expect(updates.some((t: AppTheme) => t.ui.dark.paddingMd === '20px')).toBe(true)
    expect(updates.some((t: AppTheme) => t.ui.light.borderRadiusMd === '12px')).toBe(true)
    expect(updates.some((t: AppTheme) => t.ui.light.paddingMd === '1.5rem')).toBe(true)
  })

  it('uses currentTheme when selected id disappears and closes from the header', () => {
    const onClose = vi.fn()
    const x = setup({ onClose, currentTheme: custom, themes: [TOKYO_NIGHT] })
    expect(screen.getByDisplayValue('Custom Theme')).toBeInTheDocument()
    const header = screen.getByText('Theme Remix').parentElement?.parentElement as HTMLElement
    fireEvent.click(within(header).getByRole('button'))
    expect(onClose).toHaveBeenCalled()
    x.unmount()
  })
})
