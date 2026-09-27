import type React from 'react'

/**
 * Small building blocks for the Agent Quota settings tab. They are denser than the app-wide
 * `ToggleRow` on purpose: one line per option, with any longer explanation moved into a tooltip, so
 * a whole group fits on screen next to its preview.
 */

export const FIELD = 'bg-theme-bg border border-theme-border rounded-lg text-xs text-theme-fg px-2 py-1 focus:outline-none focus:border-theme-accent'

/** A short uppercase heading for one sub-group inside a settings group. */
export function SubHeading({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className="text-[10px] text-theme-dim uppercase font-bold tracking-widest" title={hint}>
      {children}
      {hint && <span aria-hidden="true" className="ml-1 normal-case tracking-normal cursor-help">ⓘ</span>}
    </span>
  )
}

/** The bare switch, for rows that lay out their own label. */
export function Switch({ checked, onChange, ariaLabel }: { checked: boolean; onChange: () => void; ariaLabel: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      className={`shrink-0 w-8 h-4 rounded-full relative transition-colors ${checked ? 'bg-theme-accent' : 'bg-[#414868]'}`}
    >
      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

/** One-line on/off option: label (and optional one-line note) on the left, a switch on the right. */
export function CompactSwitch({ label, note, hint, checked, onChange, ariaLabel }: {
  label: string
  note?: string
  /** Longer explanation, shown as the row's tooltip. */
  hint?: string
  checked: boolean
  onChange: () => void
  ariaLabel: string
}) {
  return (
    <div className="flex items-center gap-2 min-h-[1.75rem] text-xs" title={hint}>
      <span className="flex-1 min-w-0">
        <span className="text-theme-fg">{label}</span>
        {note && <span className="ml-1.5 text-[11px] text-theme-dim">{note}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} ariaLabel={ariaLabel} />
    </div>
  )
}

/** A row of mutually exclusive buttons; the chosen one is `aria-pressed`. */
export function Segmented<T extends string>({ label, options, value, onChange }: {
  /** Leading caption; empty for a bare row. */
  label: string
  options: ReadonlyArray<{ value: T; text: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {label && <span className="w-14 text-theme-dim">{label}</span>}
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`px-2 py-0.5 rounded-lg border text-[11px] capitalize ${
            value === option.value ? 'border-theme-accent text-theme-accent font-semibold' : 'border-theme-border text-theme-dim hover:text-theme-fg'
          }`}
        >
          {option.text}
        </button>
      ))}
    </div>
  )
}
