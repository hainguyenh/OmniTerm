import { useCallback, useEffect, useMemo, useState } from 'react'

import { Dialog, Select, type DialogButton } from '../../ide/ui'
import { removeStoredSession, useStoredSessions } from '../../utils/agentSessionStorage'

import { SessionCleanupTable } from './SessionCleanupTable'
import { useSessionCleanup } from './sessionCleanupStore'
import {
  deleteSessionFiles,
  isSelectable,
  distinctValues,
  filterCleanupRows,
  formatBytes,
  listSessionFiles,
  mergeCleanupRows,
  sortCleanupRows,
  type AgentSessionFile,
  type CleanupFilter,
  type CleanupRow,
  type CleanupSort,
} from './sessionCleanupModel'

const AGE_OPTIONS = [
  { value: '0', label: 'Any time' },
  { value: '1', label: 'Idle 1+ day' },
  { value: '7', label: 'Idle 7+ days' },
  { value: '30', label: 'Idle 30+ days' },
  { value: '90', label: 'Idle 90+ days' },
]

type Pending = 'files' | 'list' | null

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

/** The listing, read when the dialog opens and again after a delete. */
function useSessionFiles() {
  const [files, setFiles] = useState<AgentSessionFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    try {
      setFiles(await listSessionFiles())
      setError(null)
    } catch (cause) {
      setFiles([])
      setError(String(cause))
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  return { files, error, reload }
}

/** Overlay: the dialog, mounted only while open. */
export function SessionCleanupOverlay() {
  const open = useSessionCleanup((s) => s.open)
  const setOpen = useSessionCleanup((s) => s.setOpen)
  if (!open) return null
  return <SessionCleanupDialog onClose={() => setOpen(false)} />
}

/**
 * Clean Up Sessions: every agent conversation on disk and every session OmniTerm remembers, by
 * agent and profile, most recently active first. Deleting removes the agent's transcript and
 * OmniTerm's entry; "Remove from list" only forgets OmniTerm's entry. Sessions running in an open
 * pane cannot be selected.
 */
export function SessionCleanupDialog({ onClose }: { onClose: () => void }) {
  const { files, error, reload } = useSessionFiles()
  const stored = useStoredSessions()
  const [filter, setFilter] = useState<CleanupFilter>({ agent: 'all', profile: 'all', olderThanDays: 0 })
  const [sort, setSort] = useState<CleanupSort>({ column: 'lastActive', descending: true })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

  const all = useMemo(() => mergeCleanupRows(files ?? [], stored, now), [files, stored, now])
  const rows = useMemo(() => sortCleanupRows(filterCleanupRows(all, filter, now), sort), [all, filter, now, sort])
  const chosen = useMemo(() => rows.filter((row) => selected.has(row.key) && isSelectable(row)), [rows, selected])
  const listed = chosen.filter((row) => row.storedId)
  const bytes = chosen.reduce((total, row) => total + (row.size ?? 0), 0)

  const agents = distinctValues(all, (row) => row.agent)
  const profiles = distinctValues(filter.agent === 'all' ? all : all.filter((row) => row.agent === filter.agent), (row) => row.profile)
  const changeFilter = (patch: Partial<CleanupFilter>) => {
    setFilter((current) => ({ ...current, ...patch }))
    setSelected(new Set())
    setPending(null)
  }

  const forget = (targets: readonly CleanupRow[]) => targets.forEach((row) => row.storedId && removeStoredSession(row.storedId))

  const confirm = async () => {
    const targets = chosen
    setBusy(true)
    try {
      if (pending === 'list') {
        forget(targets.filter((row) => row.storedId))
        setStatus(`Removed ${plural(listed.length, 'session')} from the OmniTerm list.`)
      } else {
        const fileIds = targets.flatMap((row) => row.fileId ?? [])
        const report = fileIds.length ? await deleteSessionFiles(fileIds) : { deleted: [], failed: [] }
        const deleted = new Set(report.deleted)
        forget(targets.filter((row) => !row.fileId || deleted.has(row.fileId)))
        const failed = report.failed.length ? ` ${plural(report.failed.length, 'session')} could not be deleted: ${report.failed[0]?.[1]}.` : ''
        setStatus(`Deleted ${plural(targets.length - report.failed.length, 'session')}.${failed}`)
        await reload()
      }
      setSelected(new Set())
    } catch (cause) {
      setStatus(`Delete failed: ${String(cause)}`)
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  const buttons: DialogButton[] = pending
    ? [
        { label: pending === 'files' ? 'Delete Permanently' : 'Remove', role: 'default', disabled: busy, onClick: () => void confirm() },
        { label: 'Back', role: 'cancel', disabled: busy, onClick: () => setPending(null) },
      ]
    : [
        { label: 'Delete…', role: 'extra', disabled: !chosen.length, onClick: () => setPending('files') },
        { label: 'Remove from List…', role: 'extra', disabled: !listed.length, title: 'Forget the sessions in OmniTerm, keep the agent files', onClick: () => setPending('list') },
        { label: 'Close', role: 'cancel', onClick: onClose },
      ]

  const footer = pending === 'files'
    ? `Delete ${plural(chosen.length, 'session')} (${formatBytes(bytes)}) and their agent files? This cannot be undone.`
    : pending === 'list'
      ? `Remove ${plural(listed.length, 'session')} from the OmniTerm list? The agent files stay.`
      : chosen.length
        ? `${plural(chosen.length, 'session')} selected · ${formatBytes(bytes)}`
        : status ?? `${plural(rows.length, 'session')}`

  return (
    <Dialog
      open
      onClose={pending ? () => setPending(null) : onClose}
      title="Clean Up Sessions"
      width={900}
      minHeight={420}
      resizable="both"
      buttons={buttons}
      footerStart={<span className={pending === 'files' ? 'text-[var(--danger)]' : 'text-[var(--fg-muted)]'} data-testid="session-cleanup-status">{footer}</span>}
    >
      <div className="flex h-[460px] min-h-0 flex-col gap-2" data-testid="session-cleanup-dialog">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Agent"
            value={filter.agent}
            options={[{ value: 'all', label: 'All agents' }, ...agents.map((agent) => ({ value: agent, label: agent, verbatim: true }))]}
            onChange={(agent) => changeFilter({ agent, profile: 'all' })}
          />
          <Select
            aria-label="Profile"
            value={filter.profile}
            options={[{ value: 'all', label: 'All profiles' }, ...profiles.map((profile) => ({ value: profile, label: profile, verbatim: true }))]}
            onChange={(profile) => changeFilter({ profile })}
          />
          <Select
            aria-label="Idle for"
            value={String(filter.olderThanDays)}
            options={AGE_OPTIONS}
            onChange={(days) => changeFilter({ olderThanDays: Number(days) })}
          />
          {error && <span className="text-[var(--danger)]">Could not read the agent sessions: {error}</span>}
        </div>
        {files === null ? (
          <div className="flex flex-1 items-center justify-center text-[var(--fg-muted)]">Reading agent sessions…</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-[var(--fg-muted)]">No sessions match.</div>
        ) : (
          <SessionCleanupTable rows={rows} selected={selected} onSelectedChange={setSelected} sort={sort} onSortChange={setSort} now={now} />
        )}
      </div>
    </Dialog>
  )
}
