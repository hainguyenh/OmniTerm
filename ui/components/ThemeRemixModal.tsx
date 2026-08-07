import React, { useState } from 'react'
import { X, Plus, Trash2, Copy, Check, Moon, Sun } from 'lucide-react'
import { AppTheme, TOKYO_NIGHT } from '../themes'

interface ThemeRemixModalProps {
  isOpen: boolean
  onClose: () => void
  themes: AppTheme[]
  setThemes: (t: AppTheme[]) => void
  appSettings: AppSettings
  setAppSettings: (s: AppSettings) => void
  currentTheme: AppTheme
}

export const ThemeRemixModal: React.FC<ThemeRemixModalProps> = ({
  isOpen,
  onClose,
  themes,
  setThemes,
  appSettings,
  setAppSettings,
  currentTheme,
}) => {
  const [selectedThemeId, setSelectedThemeId] = useState<string>(currentTheme.id)
  const [activeTab, setActiveTab] = useState<'ui' | 'terminal'>('ui')
  const [editMode, setEditMode] = useState<'dark' | 'light'>(appSettings.darkMode ? 'dark' : 'light')

  const selectedTheme = themes.find(t => t.id === selectedThemeId) ?? currentTheme

  const refreshThemes = async (selectId?: string) => {
    const list = await window.omnitermAPI.themes.list()
    setThemes(list)
    if (selectId) setSelectedThemeId(selectId)
  }

  const makeThemeId = () => `theme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const handleCreate = async () => {
    const newId = makeThemeId()
    const newTheme: AppTheme = {
      id: newId,
      name: `New Remix ${themes.filter(t => t.id.startsWith('theme-')).length + 1}`,
      terminal: { dark: { ...selectedTheme.terminal.dark }, light: { ...selectedTheme.terminal.light } },
      ui: { dark: { ...selectedTheme.ui.dark }, light: { ...selectedTheme.ui.light } },
    }
    await window.omnitermAPI.themes.save(newTheme)
    await refreshThemes(newId)
    const next = { ...appSettings, themeId: newId }
    setAppSettings(next)
    await window.omnitermAPI.settings.save(next)
  }

  const handleDuplicate = async () => {
    const newId = makeThemeId()
    const dup: AppTheme = {
      id: newId,
      name: `${selectedTheme.name} Copy`.slice(0, 40),
      terminal: { dark: { ...selectedTheme.terminal.dark }, light: { ...selectedTheme.terminal.light } },
      ui: { dark: { ...selectedTheme.ui.dark }, light: { ...selectedTheme.ui.light } },
    }
    await window.omnitermAPI.themes.save(dup)
    await refreshThemes(newId)
    const next = { ...appSettings, themeId: newId }
    setAppSettings(next)
    await window.omnitermAPI.settings.save(next)
  }

  const handleDelete = async () => {
    if (selectedTheme.id === TOKYO_NIGHT.id || themes.length <= 1) return
    const remaining = themes.filter(t => t.id !== selectedTheme.id)
    const fallbackId = remaining[0]?.id ?? TOKYO_NIGHT.id
    await window.omnitermAPI.themes.delete(selectedTheme.id)
    await refreshThemes(fallbackId)
    if (appSettings.themeId === selectedTheme.id) {
      const next = { ...appSettings, themeId: fallbackId }
      setAppSettings(next)
      await window.omnitermAPI.settings.save(next)
    }
  }

  const handleApply = async () => {
    const next = { ...appSettings, themeId: selectedTheme.id }
    setAppSettings(next)
    await window.omnitermAPI.settings.save(next)
  }

  const saveThemeChanges = async (updated: AppTheme) => {
    await window.omnitermAPI.themes.save(updated)
    setThemes(themes.map(t => (t.id === updated.id ? updated : t)))
  }

  const updateUIField = (key: string, value: string) => {
    const updated: AppTheme = {
      ...selectedTheme,
      ui: { ...selectedTheme.ui, [editMode]: { ...selectedTheme.ui[editMode], [key]: value } },
    }
    saveThemeChanges(updated)
  }

  const updateTerminalColor = (key: string, value: string) => {
    const updated: AppTheme = {
      ...selectedTheme,
      terminal: { ...selectedTheme.terminal, [editMode]: { ...selectedTheme.terminal[editMode], [key]: value } },
    }
    saveThemeChanges(updated)
  }

  const parseVal = (str: string): number => {
    const val = parseFloat(str)
    return typeof str === 'string' && str.endsWith('rem') ? val * 16 : (isNaN(val) ? 0 : val)
  }

  const toRemOrPx = (num: number, targetStr: string): string => {
    return typeof targetStr === 'string' && targetStr.endsWith('rem') ? `${num / 16}rem` : `${num}px`
  }

  const isColorLight = (hex: string): boolean => {
    if (!hex || !hex.startsWith('#')) return false
    const c = hex.substring(1)
    const len = c.length
    const r = parseInt(len === 3 ? c[0] + c[0] : c.substring(0, 2), 16)
    const g = parseInt(len === 3 ? c[1] + c[1] : c.substring(2, 4), 16)
    const b = parseInt(len === 3 ? c[2] + c[2] : c.substring(4, 6), 16)
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5
  }

  if (!isOpen) return null

  const ui = selectedTheme.ui[editMode]
  const terminal = selectedTheme.terminal[editMode]

  const isSidebarLight = isColorLight(ui?.sidebarBg ?? '#000')
  const activeItemBg = isSidebarLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.10)'
  const hoverItemBg = isSidebarLight ? 'hover:bg-black/5' : 'hover:bg-white/5'
  const accentTextColor = isColorLight(ui?.accent ?? '#fff') ? '#000000' : '#ffffff'
  const inputBg = isSidebarLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-4xl h-[85vh] rounded-2xl border flex flex-col overflow-hidden shadow-2xl relative w-\[900px\] h-\[600px\] max-h-\[90vh\] max-w-\[95vw\] rounded-xl border shadow-2xl flex flex-col overflow-hidden bg-theme-popup border-theme-border text-theme-fg"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-theme-border">
          <div>
            <h2 className="text-lg font-bold text-theme-fg">Theme Remix</h2>
            <p className="text-xs text-theme-dim">
              Customize app &amp; terminal layout, colors, spacing, and border roundings in real-time.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg transition-colors hover:bg-white/10 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Sidebar */}
          <aside className="w-60 border-r flex flex-col p-3 gap-3 flex-shrink-0 border-theme-border">
            <button
              type="button"
              onClick={handleCreate}
              className="w-full py-2 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all"
              style={{ backgroundColor: 'var(--theme-accent)', color: accentTextColor }}
            >
              <Plus className="w-3.5 h-3.5" />New Custom Theme
            </button>
            <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col gap-1 pr-1">
              {themes.map(t => {
                const isActive = t.id === selectedThemeId
                const isSavedActive = t.id === appSettings.themeId
                return (
                  <div
                    key={t.id}
                    className={`group flex items-center justify-between rounded-lg p-2 transition-colors ${!isActive ? hoverItemBg : ''}`}
                    style={isActive ? { backgroundColor: activeItemBg } : {}}
                  >
                    <button type="button" onClick={() => setSelectedThemeId(t.id)} className="flex-1 text-left min-w-0">
                      <div className="font-semibold text-xs truncate flex items-center gap-1">
                        {t.name}
                        {isSavedActive && <span className="w-1.5 h-1.5 rounded-full bg-green-400" title="Active Theme" />}
                      </div>
                      <div className="text-[10px] text-theme-dim">
                        {t.id.startsWith('theme-') ? 'Custom' : 'Built-in'}
                      </div>
                    </button>
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                      <button type="button" onClick={handleDuplicate} title="Duplicate" className="p-1 rounded hover:bg-white/10">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      {t.id.startsWith('theme-') && (
                        <button type="button" onClick={handleDelete} title="Delete" className="p-1 rounded hover:bg-red-500/20 text-red-400">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>

          {/* Editor */}
          <section className="flex-1 flex flex-col p-4 overflow-y-auto no-scrollbar gap-4 min-w-0">
            {/* Name + Apply */}
            <div className="flex items-center gap-4 flex-wrap border-b pb-4 border-theme-border">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-[10px] uppercase font-bold tracking-widest mb-1.5 text-theme-dim">Theme Name</label>
                <input
                  type="text"
                  value={selectedTheme.name}
                  onChange={(e) => saveThemeChanges({ ...selectedTheme, name: e.target.value })}
                  className="w-full border text-sm rounded-lg px-3 py-1.5 focus:outline-none"
                  style={{ borderColor: 'var(--theme-border)', backgroundColor: inputBg, color: 'var(--theme-fg)' }}
                />
              </div>
              <button
                type="button"
                onClick={handleApply}
                disabled={appSettings.themeId === selectedTheme.id}
                className="py-1.5 px-4 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--theme-accent)', color: accentTextColor }}
              >
                <Check className="w-3.5 h-3.5" />Apply This Theme
              </button>
            </div>

            {/* Tabs + Dark/Light switcher */}
            <div className="flex items-center justify-between border-b border-theme-border">
              <div className="flex gap-2">
                {(['ui', 'terminal'] as const).map(tab => (
                  <button
                    key={tab}
                    type="button"
                    className="py-1.5 px-3 font-semibold text-xs border-b-2 transition-all"
                    style={activeTab === tab
                      ? { borderColor: 'var(--theme-accent)', color: 'var(--theme-fg)' }
                      : { borderColor: 'transparent', color: 'var(--theme-dim)' }}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab === 'ui' ? 'App Spacing & Colors' : 'Terminal Palette'}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 pb-1">
                {(['dark', 'light'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setEditMode(mode)}
                    title={`Edit ${mode} variant`}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-lg border transition-all"
                    style={editMode === mode
                      ? { borderColor: 'var(--theme-accent)', backgroundColor: 'var(--theme-accent)', color: accentTextColor }
                      : { borderColor: 'var(--theme-border)', color: 'var(--theme-dim)' }}
                  >
                    {mode === 'dark' ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
                    {mode === 'dark' ? 'Dark' : 'Light'}
                  </button>
                ))}
              </div>
            </div>

            {/* UI Tab */}
            {activeTab === 'ui' && ui && (
              <div className="flex flex-col gap-5">
                <div>
                  <h3 className="text-xs uppercase font-bold tracking-widest mb-3 text-theme-fg">Layout &amp; Spacing</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                    <div className="flex flex-col">
                      <label className="text-[11px] mb-1.5 text-theme-dim">Typography Style</label>
                      <select
                        value={ui.fontFamily}
                        onChange={(e) => updateUIField('fontFamily', e.target.value)}
                        className="border text-xs rounded-lg px-2.5 py-1.5 focus:outline-none"
                        style={{ borderColor: 'var(--theme-border)', backgroundColor: inputBg, color: 'var(--theme-fg)' }}
                      >
                        <option value='-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif'>Sans-Serif (Standard/Modern)</option>
                        <option value='Cormorant Garamond, EB Garamond, Georgia, serif'>Editorial Serif (Claude/Bookish)</option>
                        <option value='Georgia, "Times New Roman", serif'>Classic Serif (Novel/Reading)</option>
                        <option value='Inter, -apple-system, sans-serif'>Humanist Sans (Clean/Responsive)</option>
                        <option value='SF Mono, Menlo, Consolas, monospace'>Monospace (Volt/Technical)</option>
                      </select>
                    </div>

                    <div className="flex flex-col">
                      <label className="text-[11px] mb-1.5 text-theme-dim">Terminal Font Style</label>
                      <select
                        value={ui.fontFamilyMono || '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, Menlo, Monaco, "Courier New", monospace'}
                        onChange={(e) => updateUIField('fontFamilyMono', e.target.value)}
                        className="border text-xs rounded-lg px-2.5 py-1.5 focus:outline-none"
                        style={{ borderColor: 'var(--theme-border)', backgroundColor: inputBg, color: 'var(--theme-fg)' }}
                      >
                        <option value='"JetBrains Mono", "Fira Code", "Cascadia Code", monospace'>JetBrains Mono (Claude/Default)</option>
                        <option value='SF Mono, Menlo, Consolas, monospace'>SF Mono (Volt/Technical)</option>
                        <option value='"Geist Mono", "Fira Code", "JetBrains Mono", monospace'>Geist Mono (Vercel/Modern)</option>
                        <option value='"Courier New", Courier, monospace'>Courier New (Classic/Novel)</option>
                        <option value='"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, Menlo, Monaco, "Courier New", monospace'>Default Multi-Stack</option>
                      </select>
                    </div>

                    <div className="flex flex-col">
                      <div className="flex items-center justify-between text-[11px] mb-1.5">
                        <span className="text-theme-dim">Border Radius</span>
                        <span className="font-bold text-theme-fg">{ui.borderRadiusMd}</span>
                      </div>
                      <input
                        type="range" min="0" max="24"
                        value={parseVal(ui.borderRadiusMd)}
                        onChange={(e) => {
                          const val = Number(e.target.value)
                          updateUIField('borderRadiusSm', toRemOrPx(val * 0.5, ui.borderRadiusSm))
                          updateUIField('borderRadiusMd', toRemOrPx(val, ui.borderRadiusMd))
                          updateUIField('borderRadiusLg', toRemOrPx(val * 1.5, ui.borderRadiusLg))
                          updateUIField('borderRadiusXl', toRemOrPx(val * 2.0, ui.borderRadiusXl))
                        }}
                        className="w-full"
                        style={{ accentColor: 'var(--theme-accent)' }}
                      />
                    </div>

                    <div className="flex flex-col">
                      <div className="flex items-center justify-between text-[11px] mb-1.5">
                        <span className="text-theme-dim">Padding &amp; Margins</span>
                        <span className="font-bold text-theme-fg">{ui.paddingMd}</span>
                      </div>
                      <input
                        type="range" min="4" max="32"
                        value={parseVal(ui.paddingMd)}
                        onChange={(e) => {
                          const val = Number(e.target.value)
                          updateUIField('paddingSm', toRemOrPx(val * 0.6, ui.paddingSm))
                          updateUIField('paddingMd', toRemOrPx(val, ui.paddingMd))
                          updateUIField('paddingLg', toRemOrPx(val * 1.3, ui.paddingLg))
                          updateUIField('paddingXl', toRemOrPx(val * 2.0, ui.paddingXl))
                        }}
                        className="w-full"
                        style={{ accentColor: 'var(--theme-accent)' }}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs uppercase font-bold tracking-widest mb-3 text-theme-fg">App Colors</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {[
                      { key: 'background', label: 'App Background', source: 'terminal' },
                      { key: 'foreground', label: 'Primary Text', source: 'terminal' },
                      { key: 'sidebarBg', label: 'Sidebar Fill', source: 'ui' },
                      { key: 'popupBg', label: 'Dropdown/Popups', source: 'ui' },
                      { key: 'accent', label: 'Accent Color', source: 'ui' },
                      { key: 'dimText', label: 'Muted Text', source: 'ui' },
                      { key: 'border', label: 'Border/Lines', source: 'ui' },
                      { key: 'cardBg', label: 'Card/Form Fill', source: 'ui' },
                    ].map(item => {
                      const value = item.source === 'terminal' ? (terminal as any)[item.key] : (ui as any)[item.key]
                      return (
                        <div
                          key={item.key}
                          className="flex items-center justify-between border rounded-lg p-2 gap-2 text-xs"
                          style={{ borderColor: 'var(--theme-border)', backgroundColor: 'rgba(0,0,0,0.05)' }}
                        >
                          <span className="truncate text-theme-dim">{item.label}</span>
                          <input
                            type="color"
                            value={value || '#000000'}
                            onChange={(e) => item.source === 'terminal' ? updateTerminalColor(item.key, e.target.value) : updateUIField(item.key, e.target.value)}
                            className="w-6 h-6 border-0 bg-transparent cursor-pointer flex-shrink-0"
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Terminal Tab */}
            {activeTab === 'terminal' && terminal && (
              <div>
                <h3 className="text-xs uppercase font-bold tracking-widest mb-3 text-theme-fg">Terminal ANSI Colors</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {[
                    'black','red','green','yellow','blue','magenta','cyan','white',
                    'brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightMagenta','brightCyan','brightWhite',
                  ].map(key => (
                    <div
                      key={key}
                      className="flex items-center justify-between border rounded-lg p-2 gap-2 text-xs"
                      style={{ borderColor: 'var(--theme-border)', backgroundColor: 'rgba(0,0,0,0.05)' }}
                    >
                      <span className="truncate capitalize text-theme-dim">
                        {key.replace(/([A-Z])/g, ' $1')}
                      </span>
                      <input
                        type="color"
                        value={(terminal as any)[key] || '#000000'}
                        onChange={(e) => updateTerminalColor(key, e.target.value)}
                        className="w-6 h-6 border-0 bg-transparent cursor-pointer flex-shrink-0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

