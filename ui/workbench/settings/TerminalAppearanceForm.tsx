import { useRef, useState } from 'react'

import { Select } from '../../ide/features/settings/components/Form'
import { Button, Checkbox } from '../../ide/ui'
import { CUSTOM_PREFIX, findColorScheme } from '../../terminal/colorSchemes'
import {
  importItermScheme,
  parseTerminalLook,
  removeCustomScheme,
  type TerminalLookSettings,
} from '../../terminal/terminalLook'
import type { TerminalTheme } from '../../themes'

import { contrastOptions, schemeOptions } from './terminalAppearanceOptions'
import { FORM_GRID } from './TerminalCtrlCForm'

const SWATCH_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const

function Swatches({ colors }: { colors: TerminalTheme }) {
  return (
    <span
      className="inline-flex gap-0.5 rounded p-1"
      style={{ background: colors.background }}
      aria-hidden="true"
    >
      {SWATCH_KEYS.map(key => (
        <span key={key} className="inline-block h-3 w-3 rounded-sm" style={{ background: colors[key] }} />
      ))}
    </span>
  )
}

function SchemeRow({ label, value, look, onSelect, onRemove }: {
  label: string
  value: string
  look: TerminalLookSettings
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}) {
  const scheme = findColorScheme(value, look.customSchemes)
  return (
    <>
      <span>{label}</span>
      <span className="flex flex-wrap items-center gap-2">
        <Select aria-label={label} value={value} options={schemeOptions(look)} onChange={onSelect} />
        {scheme && <Swatches colors={scheme.colors} />}
        {value.startsWith(CUSTOM_PREFIX) && (
          <Button size="small" variant="ghost" onClick={() => onRemove(value)}>Remove</Button>
        )}
      </span>
    </>
  )
}

/**
 * Settings › Terminal, Appearance: the color scheme per app mode (presets or imported `.itermcolors`
 * files, like iTerm2's color presets), minimum contrast, bold-as-bright, and output coloring. Saves
 * at once; open panes follow on the settings broadcast.
 */
export function TerminalAppearanceForm({ value, smartColors, onChange, onSmartColorsChange }: {
  value: unknown
  smartColors: boolean
  onChange: (next: TerminalLookSettings) => void
  onSmartColorsChange: (next: boolean) => void
}) {
  const look = parseTerminalLook(value)
  const set = (fields: Partial<TerminalLookSettings>) => onChange({ ...look, ...fields })
  const fileInput = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const importFile = async (file: File) => {
    const next = importItermScheme(look, file.name, await file.text())
    setImportError(next ? null : `${file.name} is not an iTerm2 color preset.`)
    if (next) onChange(next)
  }

  return (
    <div className={`${FORM_GRID} px-1 pb-3`}>
      <SchemeRow
        label="Scheme (dark mode)"
        value={look.darkScheme}
        look={look}
        onSelect={(darkScheme) => set({ darkScheme })}
        onRemove={(id) => onChange(removeCustomScheme(look, id))}
      />
      <SchemeRow
        label="Scheme (light mode)"
        value={look.lightScheme}
        look={look}
        onSelect={(lightScheme) => set({ lightScheme })}
        onRemove={(id) => onChange(removeCustomScheme(look, id))}
      />
      <span>Import</span>
      <span className="flex flex-wrap items-center gap-2">
        <Button size="small" onClick={() => fileInput.current?.click()}>Import .itermcolors…</Button>
        <input
          ref={fileInput}
          type="file"
          accept=".itermcolors,application/xml,text/xml"
          className="hidden"
          aria-label="iTerm2 color preset file"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importFile(file)
          }}
        />
        {importError && <span role="alert" className="text-xs text-theme-error">{importError}</span>}
      </span>
      <span>Minimum contrast</span>
      <Select
        aria-label="Minimum contrast"
        value={String(look.minContrast)}
        options={contrastOptions(look)}
        onChange={(v) => set({ minContrast: v === 'auto' ? 'auto' : Number(v) })}
      />
      <span>Text</span>
      <Checkbox
        checked={look.boldBright}
        onChange={(boldBright) => set({ boldBright })}
        label="Draw bold text in bright colors"
      />
      <span>Links</span>
      <Checkbox
        checked={look.linkColors}
        onChange={(linkColors) => set({ linkColors })}
        label="Color URLs and file paths in output"
      />
      <span>Smart colors</span>
      <Checkbox
        checked={smartColors}
        onChange={onSmartColorsChange}
        label="Also color errors, warnings, numbers, quoted strings and IP addresses"
      />
    </div>
  )
}
