import { Search, X } from 'lucide-react'
import { Tooltip } from '../../../ui/components/Tooltip'
import '../../../ui/components/workspace-file-tree.css'

export interface LaunchFilterInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function LaunchFilterInput({
  value,
  onChange,
  placeholder = 'Filter output...',
}: LaunchFilterInputProps) {
  return (
    <div className="workspace-search !h-7 !min-h-[28px] w-48 text-xs border border-[var(--workspace-line,color-mix(in_srgb,var(--theme-border)_60%,transparent))] focus-within:!border-theme-accent rounded-[var(--workspace-radius,4px)] px-2">
      <Search aria-hidden="true" className="w-3.5 h-3.5 text-theme-dim shrink-0" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onChange('')
          }
        }}
        placeholder={placeholder}
        aria-label="Filter output"
        className="w-full min-w-0 bg-transparent text-xs text-theme-fg placeholder:text-theme-dim focus:outline-none"
      />
      {value ? (
        <Tooltip content="Clear filter (Esc)" placement="top">
          <button
            type="button"
            aria-label="Clear filter"
            className="workspace-icon-button w-5 h-5 min-h-[20px] p-0.5 text-theme-dim hover:text-theme-fg shrink-0"
            onClick={() => onChange('')}
          >
            <X aria-hidden="true" className="w-3 h-3" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  )
}

export default LaunchFilterInput
