/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  Keycap,
  KeycapCombo,
} from '../Keycap'
import {
  extractTooltipLabelAndShortcut,
  parseShortcutKeys,
} from '../../utils/shortcutFormatting'

describe('Keycap and shortcut parsing', () => {
  it('parses various keyboard shortcut combinations', () => {
    expect(parseShortcutKeys('Ctrl+N')).toEqual(['Ctrl', 'N'])
    expect(parseShortcutKeys('Ctrl+Shift+N')).toEqual(['Ctrl', 'Shift', 'N'])
    expect(parseShortcutKeys('CommandOrControl+P')).toEqual(['Ctrl', 'P'])
    expect(parseShortcutKeys('Ctrl+0')).toEqual(['Ctrl', '0'])
    expect(parseShortcutKeys('Ctrl+=')).toEqual(['Ctrl', '='])
    expect(parseShortcutKeys('Ctrl+,')).toEqual(['Ctrl', ','])
    expect(parseShortcutKeys('Ctrl+/')).toEqual(['Ctrl', '/'])
    expect(parseShortcutKeys('Esc')).toEqual(['Esc'])
  })

  it('extracts label and shortcut from embedded text', () => {
    expect(extractTooltipLabelAndShortcut('New Terminal (Ctrl+N)')).toEqual({
      label: 'New Terminal',
      shortcut: 'Ctrl+N',
    })
    expect(extractTooltipLabelAndShortcut('Close search (Esc)')).toEqual({
      label: 'Close search',
      shortcut: 'Esc',
    })
    expect(extractTooltipLabelAndShortcut('Plain Label')).toEqual({
      label: 'Plain Label',
      shortcut: undefined,
    })
    expect(extractTooltipLabelAndShortcut('Custom Label', 'Ctrl+1')).toEqual({
      label: 'Custom Label',
      shortcut: 'Ctrl+1',
    })
  })

  it('renders a Keycap with retro styling and key label', () => {
    render(<Keycap keyName="Ctrl" />)
    const el = screen.getByTestId('keycap')
    expect(el).toBeInTheDocument()
    expect(el).toHaveTextContent('Ctrl')
    expect(el.tagName.toLowerCase()).toBe('kbd')
  })

  it('renders a KeycapCombo for multi-key shortcuts', () => {
    render(<KeycapCombo shortcut="Ctrl+Shift+N" />)
    const combo = screen.getByTestId('keycap-combo')
    expect(combo).toBeInTheDocument()
    const keycaps = screen.getAllByTestId('keycap')
    expect(keycaps).toHaveLength(3)
    expect(keycaps[0]).toHaveTextContent('Ctrl')
    expect(keycaps[1]).toHaveTextContent('Shift')
    expect(keycaps[2]).toHaveTextContent('N')
  })
})
