import { describe, expect, it } from 'vitest'
import { migrateThemeSettings } from '../utils/themeMigration'

const available = [{ id: 'tokyo-night' }, { id: 'terminal-paper' }]

describe('legacy built-in theme selection migration', () => {
  it('migrates removed built-ins at both the app and connection level without losing other settings', () => {
    const settings = {
      themeId: 'compact',
      fontSize: 16,
      shortcuts: { newSession: 'Ctrl+N' },
      perConn: {
        local: { themeId: 'volt-agent', fontSize: 19 },
        old: { themeId: 'clickhouse', fontSize: 13 },
        untouched: { themeId: 'tokyo-night', fontSize: 12 },
      },
    }
    expect(migrateThemeSettings(settings, available)).toEqual({
      ...settings,
      themeId: 'terminal-paper',
      perConn: {
        local: { themeId: 'tokyo-night', fontSize: 19 },
        old: { themeId: 'terminal-paper', fontSize: 13 },
        untouched: settings.perConn.untouched,
      },
    })
    expect(settings.themeId).toBe('compact')
    expect(settings.perConn.local.themeId).toBe('volt-agent')
  })

  it('migrates retired theme selections even when old user overrides exist on disk, without changing unrelated custom themes', () => {
    const settings = {
      themeId: 'compact',
      perConn: { a: { themeId: 'volt-agent' }, b: { themeId: 'theme-personal' } },
    }
    expect(migrateThemeSettings(settings, [...available, { id: 'compact' }, { id: 'volt-agent' }])).toEqual({
      themeId: 'terminal-paper',
      perConn: { a: { themeId: 'tokyo-night' }, b: { themeId: 'theme-personal' } },
    })
  })

  it('does not rewrite already migrated settings', () => {
    const settings = { themeId: 'terminal-paper', perConn: { a: { themeId: 'tokyo-night' } } }
    expect(migrateThemeSettings(settings, available)).toBe(settings)
  })
})
