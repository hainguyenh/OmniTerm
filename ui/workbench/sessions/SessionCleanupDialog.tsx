import { useMemo, useState, type ReactNode } from 'react'

import { Button, Checkbox, Dialog, Select, type DialogButton } from '../../ide/ui'
import { Spinner } from '../../ide/ui/Spinner'
import { useStoredSessions } from '../../utils/agentSessionStorage'
import { progressText } from '../cleanupJob'

import { SessionCleanupTable } from './SessionCleanupTable'
import {
  cancelSessionDeleteNow,
  deleteSessionRows,
  forgetRows,
  scanSessions,
  useSessionCleanup,
  type SessionDeleteJob,
} from './sessionCleanupStore'
import {
  agentLabel,
  filterCleanupRows,
  scanCoversAge,
  formatBytes,
  isSelectable,
  mergeCleanupRows,
  profilesToScan,
  selectAllKeys,
  sortCleanupRows,
  type CleanupFilter,
  type CleanupRow,
  type CleanupSort,
  type SessionProfile,
} from './sessionCleanupModel'
import { useSessionProfiles } from './useSessionCleanupScan'

const AGE_OPTIONS = [
  { value: '0', label: 'Any time' },
  { value: '1', label: '1+ day' },
  { value: '7', label: '7+ days' },
  { value: '30', label: '30+ days' },
  { value: '90', label: '90+ days' },
]

type Pending = 'files' | 'list' | null

/** The footer text of a running delete. */
function jobMessage(job: SessionDeleteJob): string {
  return job.cancelling ? 'Cancelling…' : `Deleting: ${progressText(job.progress, 'sessions', 'freed')}`
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

/** Rows drawn at first and added by "Show more": thousands at once froze the dialog. */
const ROWS_PER_PAGE = 300

const sizeOf = (rows: readonly CleanupRow[]) => rows.reduce((total, row) => total + (row.size ?? 0), 0)

/** Overlay: the dialog, mounted only while open. */
export function SessionCleanupOverlay() {
  const open = useSessionCleanup((s) => s.open)
  const setOpen = useSessionCleanup((s) => s.setOpen)
  if (!open) return null
  return <SessionCleanupDialog onClose={() => setOpen(false)} />
}

/** A filter-row field: its label, then the control (IDEA's `Label: [combo]`). */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="text-[var(--fg-muted)]">{label}</span>
      {children}
    </span>
  )
}

/**
 * Clean Up Sessions: every agent conversation on disk and every session OmniTerm remembers, by
 * agent and profile, most recently active first. Deleting removes the agent's transcript and
 * OmniTerm's entry with progress, and keeps running when the dialog is hidden (the status bar's
 * Background Tasks shows it, with Cancel); "Remove from List" only forgets OmniTerm's entry.
 * Sessions running in an open pane cannot be selected.
 */
export function SessionCleanupDialog({ onClose }: { onClose: () => void }) {
  const profiles = useSessionProfiles()
  const files = useSessionCleanup((s) => s.files)
  const scanned = useSessionCleanup((s) => s.scanned)
  const scannedDays = useSessionCleanup((s) => s.scannedDays)
  const scanning = useSessionCleanup((s) => s.scanning)
  const error = useSessionCleanup((s) => s.error)
  const job = useSessionCleanup((s) => s.job)
  const status = useSessionCleanup((s) => s.status)
  const stored = useStoredSessions()
  const [filter, setFilter] = useState<CleanupFilter>({ agent: 'all', profile: 'all', olderThanDays: 0 })
  const [sort, setSort] = useState<CleanupSort>({ column: 'lastActive', descending: true })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<Pending>(null)
  const [now] = useState(() => Date.now())
  const [shown, setShown] = useState(ROWS_PER_PAGE)
  const running = job !== null

  const scope = useMemo(() => profilesToScan(profiles ?? [], filter), [profiles, filter])
  // The rows shown come from a scan that covered the chosen agent and profile.
  const covered = files !== null && scope.every((profile) => scanned.includes(profile)) && scanCoversAge(scannedDays, filter.olderThanDays)
  const all = useMemo(() => (files ? mergeCleanupRows(files, stored, now) : []), [files, stored, now])
  const rows = useMemo(() => sortCleanupRows(filterCleanupRows(all, filter, now), sort), [all, filter, now, sort])
  const chosen = useMemo(() => rows.filter((row) => selected.has(row.key) && isSelectable(row)), [rows, selected])
  const listed = chosen.filter((row) => row.storedId)
  const bytes = sizeOf(chosen)

  const agents = [...new Set((profiles ?? []).map((item) => item.agent))]
  const agentProfiles = (profiles ?? []).filter((item) => filter.agent === 'all' || item.agent === filter.agent).map((item) => item.profile)
  const changeFilter = (patch: Partial<CleanupFilter>) => {
    setFilter((current) => ({ ...current, ...patch }))
    setShown(ROWS_PER_PAGE)
    setSelected(new Set())
    setPending(null)
  }
  const startScan = () => {
    setSelected(new Set())
    setShown(ROWS_PER_PAGE)
    void scanSessions(scope, filter.olderThanDays)
  }

  const removeFromList = () => {
    forgetRows(listed)
    useSessionCleanup.setState({ status: `Removed ${plural(listed.length, 'session')} from the OmniTerm list.` })
    setSelected(new Set())
    setPending(null)
  }

  const deleteChosen = () => {
    const targets = chosen
    setSelected(new Set())
    setPending(null)
    void deleteSessionRows(targets)
  }

  const buttons: DialogButton[] = running
    ? [
        { label: 'Run in Background', role: 'default', onClick: onClose },
        { label: 'Cancel', role: 'cancel', disabled: job.cancelling, onClick: cancelSessionDeleteNow },
      ]
    : pending
      ? [
          {
            label: pending === 'files' ? 'Delete Permanently' : 'Remove',
            role: 'default',
            onClick: pending === 'files' ? deleteChosen : removeFromList,
          },
          { label: 'Back', role: 'cancel', onClick: () => setPending(null) },
        ]
      : [{ label: 'Close', role: 'cancel', onClick: onClose }]

  const actions = pending || running ? null : (
    <span className="flex items-center gap-3">
      <Button
        icon="close"
        disabled={running || !listed.length}
        title="Forget the sessions in OmniTerm, keep the agent files"
        onClick={() => setPending('list')}
      >
        Remove from List…
      </Button>
      <Button icon="trash" disabled={running || !chosen.length} onClick={() => setPending('files')}>
        Delete…
      </Button>
    </span>
  )

  const message = job
    ? jobMessage(job)
    : pending === 'files'
      ? `Delete ${plural(chosen.length, 'session')} (${formatBytes(bytes)}) and their agent files? This cannot be undone.`
      : pending === 'list'
        ? `Remove ${plural(listed.length, 'session')} from the OmniTerm list? The agent files stay.`
        : status ?? ''

  const footerStart = (
    <span className="flex min-w-0 items-center gap-2">
      {running && <Spinner label="Deleting sessions" />}
      <span className={pending === 'files' && !running ? 'text-[var(--danger)]' : 'text-[var(--fg-muted)]'} data-testid="session-cleanup-status">
        {message}
      </span>
    </span>
  )

  // Closing while a delete runs hides the dialog; the delete goes on in the status bar.
  const close = pending && !running ? () => setPending(null) : onClose

  return (
    <Dialog
      open
      onClose={close}
      title="Clean Up Sessions"
      width={900}
      minHeight={420}
      resizable="both"
      keepInside
      buttons={buttons}
      footerStart={footerStart}
      footer={actions}
    >
      <div className="flex h-[460px] min-h-0 flex-col gap-3 px-4 pb-1 pt-3" data-testid="session-cleanup-dialog">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border)] pb-3" role="toolbar" aria-label="Scan">
          <Field label="Agent:">
            <Select
              aria-label="Agent"
              value={filter.agent}
              disabled={running}
              options={[{ value: 'all', label: 'All agents' }, ...agents.map((agent) => ({ value: agent, label: agentLabel(agent), verbatim: true }))]}
              onChange={(agent) => changeFilter({ agent, profile: 'all' })}
            />
          </Field>
          <Field label="Profile:">
            <Select
              aria-label="Profile"
              value={filter.profile}
              disabled={running}
              options={[{ value: 'all', label: 'All profiles' }, ...agentProfiles.map((profile) => ({ value: profile, label: profile, verbatim: true }))]}
              onChange={(profile) => changeFilter({ profile })}
            />
          </Field>
          <Field label="Idle for:">
            <Select
              aria-label="Idle for"
              value={String(filter.olderThanDays)}
              disabled={running}
              options={AGE_OPTIONS}
              onChange={(days) => changeFilter({ olderThanDays: Number(days) })}
            />
          </Field>
          <Checkbox
            label="Empty only"
            checked={filter.emptyOnly === true}
            disabled={running}
            onChange={(emptyOnly) => changeFilter({ emptyOnly })}
          />
          <span className="flex-1" />
          <Button
            variant="primary"
            icon="search"
            data-testid="session-cleanup-scan"
            disabled={scanning || running || !scope.length}
            onClick={startScan}
            title="Read the session folders of the chosen agent and profile on this machine"
          >
            Scan
          </Button>
        </div>
        {error && <span className="text-[var(--danger)]">Could not read the agent sessions: {error}</span>}
        <SessionCleanupBody
          profiles={profiles}
          scanning={scanning}
          covered={covered}
          scope={scope}
          rows={rows}
          shown={shown}
          onShowMore={() => setShown((count) => count + ROWS_PER_PAGE)}
          selection={(
            <SelectionBar
              rows={rows}
              chosen={chosen}
              disabled={running}
              onSelectAll={(checked) => setSelected(selectAllKeys(rows, checked))}
            />
          )}
          table={(
            <SessionCleanupTable
              rows={rows.slice(0, shown)}
              allRows={rows}
              selected={selected}
              onSelectedChange={setSelected}
              sort={sort}
              onSortChange={setSort}
              now={now}
              disabled={running}
            />
          )}
        />
      </div>
    </Dialog>
  )
}

/** Above the table: "Select all" over every row the filter keeps, and what the selection weighs. */
function SelectionBar({ rows, chosen, disabled, onSelectAll }: {
  rows: readonly CleanupRow[]
  chosen: readonly CleanupRow[]
  disabled: boolean
  onSelectAll: (checked: boolean) => void
}) {
  const selectable = rows.filter(isSelectable).length
  const summary = chosen.length
    ? `${chosen.length} selected · ${formatBytes(sizeOf(chosen))}`
    : `${plural(rows.length, 'session')} · ${formatBytes(sizeOf(rows))}`
  return (
    <div className="flex items-center gap-3" data-testid="session-cleanup-selection">
      <Checkbox
        label={`Select all ${plural(selectable, 'session')}`}
        checked={chosen.length > 0 && chosen.length === selectable}
        indeterminate={chosen.length > 0 && chosen.length < selectable}
        disabled={disabled || !selectable}
        onChange={onSelectAll}
      />
      <span className="text-[var(--fg-muted)]" data-testid="session-cleanup-summary">{summary}</span>
    </div>
  )
}

/** What the dialog shows under its filter row: where the profiles are, a prompt to scan, the scan, or the rows. */
function SessionCleanupBody({ profiles, scanning, covered, scope, rows, shown, onShowMore, selection, table }: {
  profiles: SessionProfile[] | null
  scanning: boolean
  covered: boolean
  scope: readonly string[]
  rows: readonly CleanupRow[]
  shown: number
  onShowMore: () => void
  selection: ReactNode
  table: ReactNode
}) {
  const message = (text: string) => (
    <div className="flex flex-1 items-center justify-center px-6 text-center text-[var(--fg-muted)]" data-testid="session-cleanup-message">{text}</div>
  )
  if (profiles === null) return message('Looking for agent profiles on this machine…')
  if (!profiles.length) return message('No Claude, Codex or Antigravity session folders were found on this machine.')
  if (scanning) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[var(--fg-muted)]">
        <Spinner label="Scanning" />
        Scanning {plural(scope.length, 'profile')}…
      </div>
    )
  }
  if (!covered) return message(`Choose an agent and a profile, then press Scan to read ${plural(scope.length, 'profile')} on this machine.`)
  if (!rows.length) return message('No sessions match.')
  return (
    <>
      {selection}
      {table}
      {rows.length > shown && (
        <div className="flex items-center justify-center gap-2 text-[var(--fg-muted)]">
          <span>Showing {shown} of {rows.length}</span>
          <Button size="small" onClick={onShowMore}>Show more</Button>
        </div>
      )}
    </>
  )
}
