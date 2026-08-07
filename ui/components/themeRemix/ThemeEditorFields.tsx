import React from 'react'
import type { AppTheme } from '../../themes'
import {
  APP_COLOR_FIELDS,
  LIGHT_ONLY_TERMINAL_FIELD,
  TERMINAL_COLOR_FIELDS,
  readColorField,
  resolvedColorField,
  type ColorField,
  type ThemeMode,
} from '../../utils/themeVars'

/** The controls of the Theme Remix editor: every colour the app can paint, plus spacing and type. */

const FONT_STACKS: ReadonlyArray<[string, string]> = [
  ['-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif', 'Sans-Serif (Standard/Modern)'],
  ['Cormorant Garamond, EB Garamond, Georgia, serif', 'Editorial Serif (Claude/Bookish)'],
  ['Georgia, "Times New Roman", serif', 'Classic Serif (Novel/Reading)'],
  ['Inter, -apple-system, sans-serif', 'Humanist Sans (Clean/Responsive)'],
  ['SF Mono, Menlo, Consolas, monospace', 'Monospace (Volt/Technical)'],
]

const MONO_STACKS: ReadonlyArray<[string, string]> = [
  ['"JetBrains Mono", "Fira Code", "Cascadia Code", monospace', 'JetBrains Mono (Claude/Default)'],
  ['SF Mono, Menlo, Consolas, monospace', 'SF Mono (Volt/Technical)'],
  ['"Geist Mono", "Fira Code", "JetBrains Mono", monospace', 'Geist Mono (Vercel/Modern)'],
  ['"Courier New", Courier, monospace', 'Courier New (Classic/Novel)'],
  ['"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, Menlo, Monaco, "Courier New", monospace', 'Default Multi-Stack'],
]

const parseVal = (str: string): number => {
  const val = parseFloat(str)
  return typeof str === 'string' && str.endsWith('rem') ? val * 16 : (isNaN(val) ? 0 : val)
}

const toRemOrPx = (num: number, targetStr: string): string =>
  typeof targetStr === 'string' && targetStr.endsWith('rem') ? `${num / 16}rem` : `${num}px`

const inputStyle: React.CSSProperties = {
  borderColor: 'var(--theme-border)',
  backgroundColor: 'var(--theme-bg)',
  color: 'var(--theme-fg)',
}

interface FieldsProps {
  theme: AppTheme
  mode: ThemeMode
  onColorChange: (field: ColorField, value: string) => void
  onUiFieldChange: (key: string, value: string) => void
}

/** One swatch row. Unset optional colours show the value the app falls back to, marked "auto". */
const ColorSwatch: React.FC<{
  theme: AppTheme
  mode: ThemeMode
  field: ColorField
  onChange: (value: string) => void
}> = ({ theme, mode, field, onChange }) => {
  const explicit = readColorField(theme, mode, field)
  const value = resolvedColorField(theme, mode, field)
  // `<input type="color">` only accepts #rrggbb; the rgba() fallbacks (hover, overlay) are shown as a
  // preview chip beside a text input instead of being silently mangled into an opaque hex.
  const isHex = /^#[0-9a-f]{6}$/i.test(value)

  return (
    <label
      className="flex items-center justify-between gap-2 rounded-lg border p-2 text-xs"
      style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-card-bg)' }}
      title={field.hint}
    >
      <span className="min-w-0">
        <span className="block truncate text-theme-fg">{field.label}</span>
        <span className="block truncate text-[10px] text-theme-dim">{explicit ? field.hint : `auto · ${field.hint}`}</span>
      </span>
      {isHex ? (
        <input
          type="color"
          aria-label={field.label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-6 flex-shrink-0 cursor-pointer border-0 bg-transparent"
        />
      ) : (
        <span className="flex flex-shrink-0 items-center gap-1">
          <span className="h-6 w-6 rounded border" style={{ backgroundColor: value, borderColor: 'var(--theme-border)' }} />
          <input
            type="text"
            aria-label={field.label}
            value={explicit || value}
            onChange={(e) => onChange(e.target.value)}
            className="w-24 rounded border px-1 py-0.5 text-[10px] focus:outline-none"
            style={inputStyle}
          />
        </span>
      )}
    </label>
  )
}

const Grid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{children}</div>
)

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-theme-dim">{children}</h3>
)

export const AppColorFields: React.FC<FieldsProps> = ({ theme, mode, onColorChange }) => (
  <div>
    <SectionTitle>App colors</SectionTitle>
    <Grid>
      {APP_COLOR_FIELDS.map((field) => (
        <ColorSwatch key={field.key} theme={theme} mode={mode} field={field} onChange={(v) => onColorChange(field, v)} />
      ))}
    </Grid>
  </div>
)

export const TerminalColorFields: React.FC<FieldsProps> = ({ theme, mode, onColorChange }) => {
  const fields = mode === 'light' ? [LIGHT_ONLY_TERMINAL_FIELD, ...TERMINAL_COLOR_FIELDS] : TERMINAL_COLOR_FIELDS
  return (
    <div>
      <SectionTitle>Terminal palette</SectionTitle>
      <Grid>
        {fields.map((field) => (
          <ColorSwatch key={field.key} theme={theme} mode={mode} field={field} onChange={(v) => onColorChange(field, v)} />
        ))}
      </Grid>
    </div>
  )
}

export const LayoutFields: React.FC<FieldsProps> = ({ theme, mode, onUiFieldChange }) => {
  const ui = theme.ui?.[mode]
  if (!ui) return null

  const scale = (base: string, key: 'borderRadius' | 'padding', factors: readonly [number, number, number]) => (value: number) => {
    onUiFieldChange(`${key}Sm`, toRemOrPx(value * factors[0], (ui as never)[`${key}Sm`] ?? base))
    onUiFieldChange(`${key}Md`, toRemOrPx(value, base))
    onUiFieldChange(`${key}Lg`, toRemOrPx(value * factors[1], (ui as never)[`${key}Lg`] ?? base))
    onUiFieldChange(`${key}Xl`, toRemOrPx(value * factors[2], (ui as never)[`${key}Xl`] ?? base))
  }

  return (
    <div>
      <SectionTitle>Typography &amp; spacing</SectionTitle>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <div className="flex flex-col">
          <label className="mb-1 text-[11px] text-theme-dim">Interface font</label>
          <select
            value={ui.fontFamily}
            onChange={(e) => onUiFieldChange('fontFamily', e.target.value)}
            className="rounded-lg border px-2 py-1.5 text-xs focus:outline-none"
            style={inputStyle}
          >
            {FONT_STACKS.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="mb-1 text-[11px] text-theme-dim">Terminal font</label>
          <select
            value={ui.fontFamilyMono || MONO_STACKS[4][0]}
            onChange={(e) => onUiFieldChange('fontFamilyMono', e.target.value)}
            className="rounded-lg border px-2 py-1.5 text-xs focus:outline-none"
            style={inputStyle}
          >
            {MONO_STACKS.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
          </select>
        </div>

        <div className="flex flex-col">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-theme-dim">Border radius</span>
            <span className="font-bold text-theme-fg">{ui.borderRadiusMd}</span>
          </div>
          <input
            type="range" min="0" max="24"
            aria-label="Border radius"
            value={parseVal(ui.borderRadiusMd)}
            onChange={(e) => scale(ui.borderRadiusMd, 'borderRadius', [0.5, 1.5, 2])(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'var(--theme-accent)' }}
          />
        </div>

        <div className="flex flex-col">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-theme-dim">Padding &amp; margins</span>
            <span className="font-bold text-theme-fg">{ui.paddingMd}</span>
          </div>
          <input
            type="range" min="4" max="32"
            aria-label="Padding and margins"
            value={parseVal(ui.paddingMd)}
            onChange={(e) => scale(ui.paddingMd, 'padding', [0.6, 1.3, 2])(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'var(--theme-accent)' }}
          />
        </div>
      </div>
    </div>
  )
}
