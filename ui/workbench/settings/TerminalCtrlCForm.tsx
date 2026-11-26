import { NumberInput, Select } from '../../ide/features/settings/components/Form'
import { Checkbox } from '../../ide/ui'
import { CTRL_C_LIMITS, parseCtrlCSettings, type CtrlCSettings } from '../../terminal/ctrlCSettings'

const WITH_SELECTION = [
  { value: 'copy', label: 'Copy (recommended)' },
  { value: 'interrupt', label: 'Always send interrupt' },
] as const

const DOUBLE_PRESS = [
  { value: 'close', label: 'Close session' },
  { value: 'none', label: 'Do nothing' },
] as const

/** Label column + control column, after the prototype's `.form` grid. */
export const FORM_GRID = 'grid grid-cols-[150px_minmax(0,1fr)] items-center gap-x-3 gap-y-2'

/**
 * Settings › Tools › Terminal, top: the Ctrl+C rules. They
 * save at once, like the rest of the page, and open terminals follow them on the settings broadcast.
 */
export function TerminalCtrlCForm({ value, onChange }: { value: unknown; onChange: (next: CtrlCSettings) => void }) {
  const rules = parseCtrlCSettings(value)
  const set = (fields: Partial<CtrlCSettings>) => onChange({ ...rules, ...fields })
  return (
    <div className={`${FORM_GRID} px-1 pb-3`}>
      <span>Ctrl+C with selection</span>
      <Select
        aria-label="Ctrl+C with selection"
        value={rules.withSelection}
        options={WITH_SELECTION}
        onChange={(withSelection) => set({ withSelection })}
      />
      <span>Double Ctrl+C</span>
      <Select
        aria-label="Double Ctrl+C"
        value={rules.doublePress}
        options={DOUBLE_PRESS}
        onChange={(doublePress) => set({ doublePress })}
      />
      <span>Double-press window</span>
      <NumberInput
        aria-label="Double-press window"
        value={rules.windowMs}
        min={CTRL_C_LIMITS.windowMs.min}
        max={CTRL_C_LIMITS.windowMs.max}
        step={50}
        integer
        unit="ms"
        onChange={(windowMs) => set({ windowMs })}
      />
      <span>Keep tab after exit</span>
      <NumberInput
        aria-label="Keep tab after exit"
        value={rules.keepTabSeconds}
        min={CTRL_C_LIMITS.keepTabSeconds.min}
        max={CTRL_C_LIMITS.keepTabSeconds.max}
        integer
        unit="s after a single Ctrl+C (shows restart line)"
        onChange={(keepTabSeconds) => set({ keepTabSeconds })}
      />
      <span>Show hint</span>
      <Checkbox
        checked={rules.showHint}
        onChange={(showHint) => set({ showHint })}
        label={'"Press Ctrl+C again to close" toast'}
      />
    </div>
  )
}
