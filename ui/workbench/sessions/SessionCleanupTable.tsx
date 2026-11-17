import { Checkbox, Icon } from '../../ide/ui'

import {
  agentLabel,
  formatAge,
  formatBytes,
  isSelectable,
  projectName,
  selectAllKeys,
  type CleanupRow,
  type CleanupSort,
  type CleanupSortColumn,
} from './sessionCleanupModel'

interface SessionCleanupTableProps {
  /** The rows drawn (a page of `allRows`). */
  rows: readonly CleanupRow[]
  /** Every row the filter keeps: what "Select all" selects, drawn or not. */
  allRows: readonly CleanupRow[]
  selected: ReadonlySet<string>
  onSelectedChange: (selected: Set<string>) => void
  sort: CleanupSort
  onSortChange: (sort: CleanupSort) => void
  now: number
  /** While a delete runs nothing can be picked. */
  disabled?: boolean
}

const COLUMNS: ReadonlyArray<{ column: CleanupSortColumn | null; label: string; className: string }> = [
  { column: 'agent', label: 'Agent', className: 'w-[88px]' },
  { column: 'profile', label: 'Profile', className: 'w-[110px]' },
  { column: null, label: 'Session', className: '' },
  { column: 'project', label: 'Project', className: 'w-[120px]' },
  { column: 'lastActive', label: 'Last active', className: 'w-[96px]' },
  { column: 'size', label: 'Size', className: 'w-[64px] text-right' },
  { column: null, label: 'OmniTerm', className: 'w-[84px]' },
]

function storedLabel(row: CleanupRow): string {
  if (row.open) return 'in use'
  if (row.bookmarked) return 'bookmark'
  if (row.storedState === 'interrupted') return 'resume'
  return row.storedId ? 'listed' : ''
}

/** The cleanup table: sortable headers, a select-all box, one row per conversation. */
export function SessionCleanupTable({ rows, allRows, selected, onSelectedChange, sort, onSortChange, now, disabled = false }: SessionCleanupTableProps) {
  const selectable = allRows.filter(isSelectable)
  const chosen = selectable.filter((row) => selected.has(row.key)).length
  const toggleAll = (checked: boolean) => onSelectedChange(selectAllKeys(allRows, checked))
  const toggle = (key: string, checked: boolean) => {
    const next = new Set(selected)
    if (checked) next.add(key)
    else next.delete(key)
    onSelectedChange(next)
  }
  const sortBy = (column: CleanupSortColumn) =>
    onSortChange(sort.column === column ? { column, descending: !sort.descending } : { column, descending: column === 'lastActive' || column === 'size' })

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded border border-[var(--border)]" data-testid="session-cleanup-table">
      <table className="w-full table-fixed border-collapse text-[12px]">
        <thead className="sticky top-0 z-[1] bg-[var(--bg-dialog)]">
          <tr className="border-b border-[var(--border)] text-left text-[var(--fg-muted)]">
            <th className="w-[28px] px-2 py-1">
              <Checkbox
                aria-label="Select all"
                checked={chosen > 0 && chosen === selectable.length}
                indeterminate={chosen > 0 && chosen < selectable.length}
                disabled={disabled || !selectable.length}
                onChange={toggleAll}
              />
            </th>
            {COLUMNS.map(({ column, label, className }) => (
              <th key={label} className={`px-2 py-1 font-normal ${className}`} aria-sort={column && sort.column === column ? (sort.descending ? 'descending' : 'ascending') : undefined}>
                {column ? (
                  <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--fg)]" disabled={disabled} onClick={() => sortBy(column)}>
                    {label}
                    {sort.column === column && <Icon name={sort.descending ? 'chevron-down' : 'chevron-up'} size={12} />}
                  </button>
                ) : label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={`border-b border-[var(--border)] last:border-b-0 ${row.open ? 'opacity-60' : 'hover:bg-[var(--bg-hover)]'}`}
              data-testid="session-cleanup-row"
            >
              <td className="px-2 py-1">
                <Checkbox
                  aria-label={`Select ${row.title ?? row.sessionId}`}
                  checked={selected.has(row.key)}
                  disabled={disabled || !isSelectable(row)}
                  onChange={(checked) => toggle(row.key, checked)}
                />
              </td>
              <td className="truncate px-2 py-1">{agentLabel(row.agent)}</td>
              <td className="truncate px-2 py-1" title={row.profile}>{row.profile}</td>
              <td className="px-2 py-1" title={[row.title, row.sessionId].filter(Boolean).join('\n')}>
                <div className="truncate text-[var(--fg)]">{row.title ?? 'Untitled session'}</div>
                <div className="truncate text-[11px] text-[var(--fg-muted)]">{row.sessionId}</div>
              </td>
              <td className="truncate px-2 py-1" title={row.cwd}>{projectName(row.cwd)}</td>
              <td className="truncate px-2 py-1" title={new Date(row.lastActive).toLocaleString()}>{formatAge(row.lastActive, now)}</td>
              <td className="truncate px-2 py-1 text-right">{row.size === null ? '—' : formatBytes(row.size)}</td>
              <td className="truncate px-2 py-1 text-[var(--fg-muted)]">{storedLabel(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
