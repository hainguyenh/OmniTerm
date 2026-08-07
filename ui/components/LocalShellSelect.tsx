import type { ShellOption } from '../shellOptions'

/**
 * The LOCAL shell picker. Renders exactly what the host reported as installed — it has no list of its
 * own, which is what the OS-branched `LocalShellOptions` it replaces got wrong on Linux.
 */
export function LocalShellSelect({
  options,
  value,
  onChange,
  labelClass,
  selectClass,
}: {
  options: ShellOption[]
  value: string
  onChange: (id: string) => void
  labelClass: string
  selectClass: string
}) {
  return (
    <div className="space-y-0.5">
      <label className={labelClass}>Shell</label>
      <select value={value} onChange={e => onChange(e.target.value)} className={selectClass}>
        {options.map(opt => (
          <option key={opt.id} value={opt.id}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
}
