import React, { useEffect, useRef, useState } from 'react'
import { Palette, Check } from 'lucide-react'
import type { AppTheme } from '../themes'

interface AppearanceMenuProps {
  themes: AppTheme[]
  themeId: string
  fontSize: number
  darkMode: boolean
  /** Shown as a pill next to "Theme" — whose look this menu is changing, e.g. "active terminal",
   * "this terminal", or a pane's own label. */
  scopeLabel: string
  buttonTitle?: string
  onThemeApply: (themeId: string) => void
  onFontSizeChange: (delta: number) => void
  /** Only offered where there is a wider scope to fan out to (the app-wide default). */
  onApplyToAll?: () => void
  /** Only the TitleBar links out to the remix modal. */
  onRemix?: () => void
  /** Smaller footprint for the pane header, where the row is already tight. */
  compact?: boolean
}

/**
 * The theme + font-size control shared by every place a terminal's look can be changed: the
 * TitleBar (focused terminal), a detached window's own title bar, and — per-pane — PaneHeader.
 * Each host supplies what "this terminal" resolves to; the menu itself has no opinion on scope.
 */
const AppearanceMenu: React.FC<AppearanceMenuProps> = ({
  themes, themeId, fontSize, darkMode, scopeLabel, buttonTitle,
  onThemeApply, onFontSizeChange, onApplyToAll, onRemix, compact,
}) => {
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onClick = (e: MouseEvent) => {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [open])

  const btnSize = compact ? 'w-4 h-4' : 'w-6 h-6'
  const iconSize = compact ? 'w-3 h-3' : 'w-3.5 h-3.5'
  const stepSize = compact ? 'w-4 h-4' : 'w-5 h-5'

  return (
    <>
      <div className="relative flex-shrink-0">
        <button
          ref={btnRef}
          type="button"
          title={buttonTitle ?? 'Appearance — theme & font size'}
          onClick={() => setOpen(v => !v)}
          className={`inline-flex items-center justify-center ${btnSize} rounded-lg border transition-colors hover:bg-white/5 ${
            open
              ? 'border-[var(--theme-accent)] text-[var(--theme-accent)]'
              : 'border-theme-border text-inherit opacity-70 hover:opacity-100'
          }`}
        >
          <Palette className={iconSize} />
        </button>
        {open && (
          <div
            ref={popRef}
            className="absolute right-0 top-full mt-1.5 z-[100] border rounded-xl shadow-2xl py-1 min-w-[200px]"
            style={{ backgroundColor: 'var(--theme-popup-bg)', borderColor: 'var(--theme-border)', color: 'var(--theme-fg)' }}
          >
            <div className="px-3 py-1.5 flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-theme-dim">
              Theme
              <span className="normal-case font-medium tracking-normal text-[9px] px-1.5 py-0.5 rounded-full bg-black/10 border border-theme-border">
                {scopeLabel}
              </span>
            </div>
            <div className="max-h-60 overflow-y-auto no-scrollbar">
              {themes.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { onThemeApply(t.id); setOpen(false) }}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-xs transition-colors hover:bg-white/5 ${
                    themeId === t.id ? 'text-[var(--theme-accent)] font-bold' : 'text-inherit opacity-85 hover:opacity-100'
                  }`}
                >
                  <span
                    className="flex items-center justify-center gap-0.5 w-9 h-5 rounded border flex-shrink-0"
                    style={{ background: darkMode ? t.terminal.dark.background : t.terminal.light.background, borderColor: 'var(--theme-border)' }}
                  >
                    {[t.terminal.dark.red, t.terminal.dark.green, t.terminal.dark.blue].map((c: string, i: number) => (
                      <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="flex-1 text-left truncate">{t.name}</span>
                  {themeId === t.id && <Check className="w-3 h-3 flex-shrink-0 text-[var(--theme-accent)]" />}
                </button>
              ))}
            </div>
            {(onApplyToAll || onRemix) && <div className="my-1 border-t border-theme-border" />}
            {onApplyToAll && (
              <button
                type="button"
                onClick={() => { onApplyToAll(); setOpen(false) }}
                className="w-full flex items-center px-3 py-2 text-xs transition-colors hover:bg-white/5 text-inherit"
              >
                Apply to all terminals
              </button>
            )}
            {onRemix && (
              <button
                type="button"
                onClick={() => { setOpen(false); onRemix() }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-white/5 text-inherit"
              >
                <Palette className="w-3.5 h-3.5 text-[var(--theme-accent)]" />Theme Remix…
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 rounded-lg border px-1 border-theme-border bg-black/10">
        <button type="button" onClick={() => onFontSizeChange(-1)} className={`${stepSize} flex items-center justify-center text-theme-dim hover:text-theme-accent transition-colors`} title="Decrease font size">-</button>
        <span className={`${compact ? 'w-4' : 'w-5'} text-center font-mono text-[10px] text-theme-fg`} title={scopeLabel}>{fontSize}</span>
        <button type="button" onClick={() => onFontSizeChange(1)} className={`${stepSize} flex items-center justify-center text-theme-dim hover:text-theme-accent transition-colors`} title="Increase font size">+</button>
      </div>
    </>
  )
}

export default AppearanceMenu
