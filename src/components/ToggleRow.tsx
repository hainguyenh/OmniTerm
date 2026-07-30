import React from 'react'

/**
 * Labeled on/off switch row: a full-width button whose border tracks the state, with the switch on the
 * right. Used by the RDP file-transfer option and the LOCAL keep-open option.
 *
 * The knob is positioned with `left`, not a transform. An absolutely-positioned box with no horizontal
 * anchor keeps its *static* position — and a `<button>` centers its content — so a translate-only knob
 * starts mid-track and slides out past the end of it.
 */
export default function ToggleRow({ label, description, checked, onChange, icon, ariaLabel }: {
  label: string
  description: string
  checked: boolean
  onChange: () => void
  icon?: React.ReactNode
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      className={`w-full flex items-center gap-2 py-1.5 px-3 rounded-xl border transition-colors text-sm text-left ${
        checked ? 'border-[#9ece6a] text-theme-success' : 'border-theme-border text-theme-fg hover:border-theme-accent hover:text-white'
      }`}
    >
      {icon}
      <span className="flex-1">
        {label}
        <span className="block text-xs text-theme-dim font-normal">{description}</span>
      </span>
      <span className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${checked ? 'bg-theme-accent' : 'bg-[#414868]'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}
