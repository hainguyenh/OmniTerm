/** @vitest-environment jsdom */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AppTheme } from '../themes'
import { ThemePreview } from '../components/themeRemix/ThemePreview'
import { isSquareTheme, themeCssVars } from '../utils/themeVars'

import terminalPaper from '../../src-tauri/builtinThemes/terminalPaper.json'

const builtinDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src-tauri/builtinThemes')

describe('Terminal Paper built-in theme', () => {
  const theme = terminalPaper as AppTheme

  it('publishes Terminal Paper as a distinct built-in from legacy customized Compact', () => {
    expect(theme.id).toBe('terminal-paper')
    expect(theme.name).toBe('TLR')
    expect(theme.terminal.light.background).toBe('#E9E5DD')
    expect(theme.terminal.light.foreground).toBe('#171716')
    expect(theme.ui.light.sidebarBg).toBe('#DED9CF')
    expect(theme.ui.light.accent).toBe('#A96F28')
    expect(theme.ui.light.accentFg).toBe('#100F0E')
    expect(theme.ui.light.fontFamily).toContain('JetBrains Mono')
    expect(theme.ui.light.fontFamily).not.toContain('Inter')
    expect(theme.ui.light.fontFamilyMono).toContain('JetBrains Mono')
    expect(isSquareTheme(theme)).toBe(true)
    expect(themeCssVars(theme, 'light')['--theme-border']).toBe('rgba(23, 23, 22, 0.16)')
  })

  it('provides a designed graphite dark variant, not an inverted paper page', () => {
    expect(theme.terminal.dark.background).toBe('#242321')
    expect(theme.terminal.dark.foreground).toBe('#E9E5DD')
    expect(theme.ui.dark.sidebarBg).toBe('#171716')
    expect(theme.ui.dark.accent).not.toBe('#faff69')
  })

  it('keeps the Terminal Paper ornament in the theme preview', () => {
    render(<ThemePreview theme={theme} mode="light" />)
    expect(screen.getByTestId('theme-preview-light')).toHaveClass('theme-terminal-paper', 'terminal-paper-surface')
  })

  it('styles the preview and the clipped app surface instead of the transparent Windows root', () => {
    const css = fs.readFileSync(path.join(builtinDir, '../../ui/terminalPaper.css'), 'utf8')
    expect(css).toContain('.theme-terminal-paper.terminal-paper-surface')
    expect(css).toContain('.theme-terminal-paper .terminal-paper-surface')
    expect(css).not.toContain('.theme-terminal-paper #root')
    expect(css).toContain('html.win-window.theme-square .app-window-rounded')
    expect(css).toContain('.theme-square .semantic-status-dot')
    expect(css).not.toContain('.theme-square [data-terminal-toolbar-switch]')
  })

  it('does not ship removed ClickHouse or Volt Agent themes', () => {
    const themes = fs.readdirSync(builtinDir)
      .filter(name => name.endsWith('.json'))
      .map(name => JSON.parse(fs.readFileSync(path.join(builtinDir, name), 'utf8')) as { id: string; name: string })
    expect(themes.some(entry => /clickhouse|click.house|volt.agent/i.test(entry.id + ' ' + entry.name))).toBe(false)
    expect(themes.some(entry => entry.id === 'compact')).toBe(false)
    expect(themes.some(entry => entry.id === 'terminal-paper')).toBe(true)
  })
})
