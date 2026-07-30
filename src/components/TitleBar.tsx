import React, { useState, useEffect, useRef } from 'react'
import { Minus, Square, Copy, X, Sun, Moon, Palette, Check, Settings } from 'lucide-react'
import { appLogo } from '../assets/appLogo'
import { diag } from '../diag'

interface TitleBarProps {
  appSettings: AppSettings
  setAppSettings: (s: AppSettings) => void
  themes: any[]
  onSettingsOpen: () => void
  setThemeRemixOpen: (open: boolean) => void
  updateState: UpdateState | null
}

export const TitleBar: React.FC<TitleBarProps> = ({
  appSettings,
  setAppSettings,
  themes,
  onSettingsOpen,
  setThemeRemixOpen,
  updateState,
}) => {
  const [isMaximized, setIsMaximized] = useState(false)
  const [themePickerOpen, setThemePickerOpen] = useState(false)
  const [version, setVersion] = useState<string>('')
  const themePickerRef = useRef<HTMLDivElement>(null)
  const themePickerBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    window.omnitermAPI.updates.getVersion().then(setVersion).catch((err) => {
      diag.error('Failed to get app version:', err)
    })
  }, [])

  useEffect(() => {
    window.omnitermAPI.windowControl.isMaximized().then(setIsMaximized)
    return window.omnitermAPI.windowControl.onMaximizedState((state) => {
      setIsMaximized(state)
    })
  }, [])

  useEffect(() => {
    if (!themePickerOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setThemePickerOpen(false) }
    const onClick = (e: MouseEvent) => {
      if (
        themePickerRef.current && !themePickerRef.current.contains(e.target as Node) &&
        themePickerBtnRef.current && !themePickerBtnRef.current.contains(e.target as Node)
      ) setThemePickerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [themePickerOpen])

  const handleMinimize = () => window.omnitermAPI.windowControl.minimize()
  const handleToggleMaximize = () => window.omnitermAPI.windowControl.toggleMaximize()
  const handleClose = () => window.omnitermAPI.windowControl.close()

  const isLightMode = !appSettings.darkMode

  const applyTheme = (themeId: string) => {
    const next = { ...appSettings, themeId }
    setAppSettings(next)
    window.omnitermAPI.settings.save(next)
  }

  const handleToggleMode = async () => {
    const next = { ...appSettings, darkMode: !appSettings.darkMode }
    setAppSettings(next)
    await window.omnitermAPI.settings.save(next)
  }

  const updateFontSize = (delta: number) => {
    const currentSize = appSettings.fontSize || 14
    const nextSize = Math.max(8, Math.min(48, currentSize + delta))
    const nextSettings = { ...appSettings, fontSize: nextSize }
    setAppSettings(nextSettings)
    window.omnitermAPI.settings.save(nextSettings)
  }

  return (
    <div
      className="h-7 flex items-center justify-between select-none border-b flex-shrink-0"
      data-tauri-drag-region
      style={{
        backgroundColor: 'var(--theme-sidebar-bg)',
        borderColor: 'var(--theme-border)',
        color: 'var(--theme-fg)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* Left: App Logo & Title */}
      <div className="flex items-center gap-2 pl-3 select-none pointer-events-none">
        <img src={appLogo} alt="Logo" className="w-4 h-4 object-cover" />
        <span className="text-[11px] font-bold tracking-wide uppercase opacity-90">OmniTerm</span>
        {version && (
          <span className="text-[9px] opacity-50 font-medium">- v{version}</span>
        )}
      </div>

      {/* Right: controls — no-drag zone */}
      <div
        className="flex h-full items-center pr-1 gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Settings button — opens Backup / About / Check for Updates */}
        <button
          type="button"
          onClick={onSettingsOpen}
          title={updateState?.updateAvailable ? "Settings (Update available!)" : "Settings"}
          className="relative inline-flex items-center justify-center w-6 h-6 rounded-lg border transition-colors hover:bg-white/5 border-[var(--theme-border)] text-inherit opacity-70 hover:opacity-100"
        >
          <Settings className="w-3.5 h-3.5" />
          {updateState?.updateAvailable && (
            <span className="absolute -bottom-0.5 -right-0.5 block h-1.5 w-1.5 rounded-full bg-theme-accent ring-1 ring-[var(--theme-popup-bg)]" />
          )}
        </button>

        {/* Theme picker */}
        <div className="relative flex-shrink-0">
          <button
            ref={themePickerBtnRef}
            type="button"
            title="Appearance — theme & font size"
            onClick={() => setThemePickerOpen(v => !v)}
            className={`inline-flex items-center justify-center w-6 h-6 rounded-lg border transition-colors hover:bg-white/5 ${
              themePickerOpen
                ? 'border-[var(--theme-accent)] text-[var(--theme-accent)]'
                : 'border-[var(--theme-border)] text-inherit opacity-70 hover:opacity-100'
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
          </button>
          {themePickerOpen && (
            <div
              ref={themePickerRef}
              className="absolute right-0 top-full mt-1.5 z-[100] border rounded-xl shadow-2xl py-1 min-w-[200px]"
              style={{
                backgroundColor: 'var(--theme-popup-bg)',
                borderColor: 'var(--theme-border)',
                color: 'var(--theme-fg)',
              }}
            >
              <div className="px-3 py-1.5 text-[10px] uppercase font-bold tracking-widest text-theme-dim">Theme</div>
              <div className="max-h-60 overflow-y-auto no-scrollbar">
                {themes.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { applyTheme(t.id); setThemePickerOpen(false) }}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-xs transition-colors hover:bg-white/5 ${
                      appSettings.themeId === t.id ? 'text-[var(--theme-accent)] font-bold' : 'text-inherit opacity-85 hover:opacity-100'
                    }`}
                  >
                    <span
                      className="flex items-center justify-center gap-0.5 w-9 h-5 rounded border flex-shrink-0"
                      style={{ background: appSettings.darkMode ? t.terminal.dark.background : t.terminal.light.background, borderColor: 'var(--theme-border)' }}
                    >
                      {[t.terminal.dark.red, t.terminal.dark.green, t.terminal.dark.blue].map((c: string, i: number) => (
                        <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />
                      ))}
                    </span>
                    <span className="flex-1 text-left truncate">{t.name}</span>
                    {appSettings.themeId === t.id && <Check className="w-3 h-3 flex-shrink-0 text-[var(--theme-accent)]" />}
                  </button>
                ))}
              </div>

              <div className="my-1 border-t border-theme-border" />
              <div className="px-3 py-1.5 flex items-center justify-between">
                <span className="text-[11px] text-theme-fg">Terminal Font Size</span>
                <div className="flex items-center gap-1.5 rounded-lg border px-1 border-theme-border bg-black/10">
                  <button type="button" onClick={() => updateFontSize(-1)} className="w-5 h-5 flex items-center justify-center text-theme-dim hover:text-theme-accent transition-colors" title="Decrease font size">-</button>
                  <span className="w-5 text-center font-mono text-[10px] text-theme-fg">{appSettings.fontSize || 14}</span>
                  <button type="button" onClick={() => updateFontSize(1)} className="w-5 h-5 flex items-center justify-center text-theme-dim hover:text-theme-accent transition-colors" title="Increase font size">+</button>
                </div>
              </div>

              <div className="my-1 border-t border-theme-border" />
              <button
                type="button"
                onClick={() => { setThemePickerOpen(false); setThemeRemixOpen(true) }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-white/5 text-inherit"
              >
                <Palette className="w-3.5 h-3.5 text-[var(--theme-accent)]" />Theme Remix…
              </button>
            </div>
          )}
        </div>

        {/* Mode Toggle */}
        <button
          type="button"
          onClick={handleToggleMode}
          title={isLightMode ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          className="inline-flex items-center justify-center w-6 h-6 rounded-lg border transition-colors hover:bg-white/5 border-[var(--theme-border)] text-inherit opacity-70 hover:opacity-100"
        >
          {isLightMode ? (
            <Moon className="w-3.5 h-3.5" />
          ) : (
            <Sun className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Minimize */}
        <button
          type="button"
          onClick={handleMinimize}
          className="w-9 h-full flex items-center justify-center hover:bg-white/10 text-inherit transition-colors"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        {/* Maximize / Restore */}
        <button
          type="button"
          onClick={handleToggleMaximize}
          className="w-9 h-full flex items-center justify-center hover:bg-white/10 text-inherit transition-colors"
          title={isMaximized ? 'Restore Down' : 'Maximize'}
        >
          {isMaximized ? (
            <Copy className="w-3 h-3 rotate-180" />
          ) : (
            <Square className="w-3 h-3" />
          )}
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={handleClose}
          className="w-9 h-full flex items-center justify-center hover:bg-red-600 hover:text-white text-inherit transition-colors"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
