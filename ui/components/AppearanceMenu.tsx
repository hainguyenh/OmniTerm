import React, { useEffect, useRef, useState } from 'react'
import { Palette, Check, Sparkles, Database, BookOpen, Flame, Moon, Triangle, TextCursorInput, Zap } from 'lucide-react'
import type { AppTheme } from '../themes'
import { Tooltip } from './Tooltip'

function getThemeIcon(themeId: string) {
  const id = themeId.toLowerCase()
  if (id.includes('claude')) return Sparkles
  if (id.includes('clickhouse')) return Database
  if (id.includes('novel')) return BookOpen
  if (id.includes('tokyohot') || id.includes('tokyo-hot') || id.includes('hot')) return Flame
  if (id.includes('tokyonight') || id.includes('tokyo-night') || id.includes('night')) return Moon
  if (id.includes('vercel')) return Triangle
  if (id.includes('volt') || id.includes('voltagent') || id.includes('bolt')) return Zap
  return Palette
}

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
  /** Render only the theme trigger; callers can place font sizing separately. */
  hideFontSize?: boolean
  /** Render a full menu row instead of compact terminal chrome. */
  menuItem?: boolean
}

export const FontSizeControl: React.FC<{
  fontSize: number
  scopeLabel: string
  onFontSizeChange: (delta: number) => void
  compact?: boolean
  fullWidth?: boolean
}> = ({ fontSize, scopeLabel, onFontSizeChange, compact, fullWidth }) => {
  const stepSize = compact ? 'w-4 h-4' : 'w-5 h-5'
  if (fullWidth) {
    return (
      <div className="flex w-full items-center gap-2 rounded-md bg-theme-popup px-2 py-1.5 text-xs text-theme-fg">
        <TextCursorInput className="h-3.5 w-3.5 flex-shrink-0 text-theme-dim" />
        <span className="flex-1">Font size</span>
        <div className="flex items-center gap-1.5 rounded-lg border px-1 border-theme-border bg-black/10">
          <button type="button" onClick={() => onFontSizeChange(-1)} className={`${stepSize} flex items-center justify-center text-theme-dim hover:text-theme-accent transition-colors`}>-</button>
          <span className={`${compact ? 'w-4' : 'w-5'} text-center font-mono text-[10px] text-theme-fg`} title={scopeLabel}>{fontSize}</span>
          <button type="button" onClick={() => onFontSizeChange(1)} className={`${stepSize} flex items-center justify-center text-theme-dim hover:text-theme-accent transition-colors`}>+</button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5 rounded-lg border px-1 border-theme-border bg-black/10">
      <Tooltip content="Decrease font size" placement="bottom">
        <button type="button" onClick={() => onFontSizeChange(-1)} className={`${stepSize} flex items-center justify-center text-theme-dim hover:text-theme-accent transition-colors`}>-</button>
      </Tooltip>
      <span className={`${compact ? 'w-4' : 'w-5'} text-center font-mono text-[10px] text-theme-fg`} title={scopeLabel}>{fontSize}</span>
      <Tooltip content="Increase font size" placement="bottom">
        <button type="button" onClick={() => onFontSizeChange(1)} className={`${stepSize} flex items-center justify-center text-theme-dim hover:text-theme-accent transition-colors`}>+</button>
      </Tooltip>
    </div>
  )
}

/** Estimated non-list height of the popup: header row + padding, plus action rows when present. */
const menuChromeHeight = (hasActions: boolean): number => (hasActions ? 108 : 44)

/** Pick the side with more room and cap the scrollable list so the popup fits the viewport. */
const computeMenuPlacement = (
  rect: DOMRect | null | undefined,
  chrome: number,
): { vertical: 'bottom' | 'top'; maxHeight: number } => {
  if (!rect) return { vertical: 'bottom', maxHeight: 240 }
  const margin = 8
  const spaceBelow = window.innerHeight - rect.bottom - margin
  const spaceAbove = rect.top - margin
  const vertical = spaceBelow >= spaceAbove ? 'bottom' : 'top'
  const space = vertical === 'bottom' ? spaceBelow : spaceAbove
  return {
    vertical,
    maxHeight: Math.max(96, Math.min(240, Math.floor(space) - chrome)),
  }
}

/**
 * The theme + font-size control shared by every place a terminal's look can be changed: the
 * TitleBar (focused terminal), a detached window's own title bar, and — per-pane — PaneHeader.
 * Each host supplies what "this terminal" resolves to; the menu itself has no opinion on scope.
 */
const AppearanceMenu: React.FC<AppearanceMenuProps> = ({
  themes, themeId, fontSize, darkMode, scopeLabel, buttonTitle,
  onThemeApply, onFontSizeChange, onApplyToAll, onRemix, compact, hideFontSize, menuItem,
}) => {
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  // Decided at open time from the trigger's viewport position so the popup never renders past
  // the window edge — pane headers sit anywhere in a split layout, and a bottom-docked pane's
  // header leaves no room below for the default open-downward popup.
  const [placement, setPlacement] = useState<{ vertical: 'bottom' | 'top'; maxHeight: number }>({
    vertical: 'bottom',
    maxHeight: 240,
  })
  const chromeReserve = menuChromeHeight(Boolean(onApplyToAll || onRemix))

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onClick = (e: MouseEvent) => {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    // A resize can move the trigger out of the side the placement was computed for.
    const onResize = () => setPlacement(computeMenuPlacement(btnRef.current?.getBoundingClientRect(), chromeReserve))
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [open, chromeReserve])

  const toggleOpen = () => {
    if (open) { setOpen(false); return }
    setPlacement(computeMenuPlacement(btnRef.current?.getBoundingClientRect(), chromeReserve))
    setOpen(true)
  }

  const btnSize = compact ? 'w-4 h-4' : 'w-6 h-6'
  const iconSize = compact ? 'w-3 h-3' : 'w-3.5 h-3.5'
  const triggerLabel = menuItem ? 'Theme' : buttonTitle ?? 'Appearance — theme & font size'

  return (
    <>
      <div className={`relative ${menuItem ? 'w-full' : 'flex-shrink-0'}`}>
        <Tooltip content={triggerLabel} placement="bottom">
          <button
            ref={btnRef}
            type="button"
            role={menuItem ? 'menuitem' : undefined}
            aria-label={triggerLabel}
            aria-haspopup={menuItem ? 'menu' : undefined}
            aria-expanded={menuItem ? open : undefined}
            onClick={toggleOpen}
            className={menuItem
              ? 'flex w-full items-center gap-2 rounded-md bg-theme-popup px-2 py-1.5 text-left text-xs text-theme-fg hover:bg-theme-hover'
              : `inline-flex items-center justify-center ${btnSize} rounded-lg border transition-colors hover:bg-white/5 ${
              open
                ? 'border-[var(--theme-accent)] text-[var(--theme-accent)]'
                : 'border-theme-border text-inherit opacity-70 hover:opacity-100'
              }`}
          >
            <Palette className={iconSize} />
            {menuItem && <span>Theme</span>}
          </button>
        </Tooltip>
        {open && (
          <div
            ref={popRef}
            className={`absolute right-0 z-[100] border rounded-xl shadow-2xl py-1 min-w-[200px] ${
              placement.vertical === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
            }`}
            style={{ backgroundColor: 'var(--theme-popup-bg)', borderColor: 'var(--theme-border)', color: 'var(--theme-fg)' }}
          >
            <div className="px-3 py-1.5 flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-theme-dim">
              Theme
              <span className="normal-case font-medium tracking-normal text-[9px] px-1.5 py-0.5 rounded-full bg-black/10 border border-theme-border">
                {scopeLabel}
              </span>
            </div>
            <div className="overflow-y-auto no-scrollbar" style={{ maxHeight: placement.maxHeight }}>
              {themes.map(t => {
                const Icon = getThemeIcon(t.id)
                const accent = t.ui[darkMode ? 'dark' : 'light'].accent
                const bg = darkMode ? t.terminal.dark.background : t.terminal.light.background
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { onThemeApply(t.id); setOpen(false) }}
                    className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors hover:bg-white/5 ${
                      themeId === t.id ? 'text-[var(--theme-accent)] font-bold' : 'text-inherit opacity-85 hover:opacity-100'
                    }`}
                  >
                    <span
                      className="flex items-center justify-center w-6 h-6 rounded-lg border flex-shrink-0"
                      style={{ background: bg, borderColor: 'var(--theme-border)', color: accent }}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <span className="flex-1 text-left truncate">{t.name}</span>
                    {themeId === t.id && <Check className="w-3 h-3 flex-shrink-0 text-[var(--theme-accent)]" />}
                  </button>
                )
              })}
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
      {!hideFontSize && <FontSizeControl fontSize={fontSize} scopeLabel={scopeLabel} onFontSizeChange={onFontSizeChange} compact={compact} />}
    </>
  )
}

export default AppearanceMenu
