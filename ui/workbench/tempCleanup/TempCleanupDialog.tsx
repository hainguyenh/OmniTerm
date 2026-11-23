import { useState } from 'react'

import { Button, Checkbox, Dialog, Select, type DialogButton } from '../../ide/ui'
import { Spinner } from '../../ide/ui/Spinner'
import { progressText } from '../cleanupJob'
import { formatBytes } from '../sessions/sessionCleanupModel'

import { daysSince, deletable, deletableTotal, type TempGroup } from './tempCleanupModel'
import { cancelTempJobNow, startTempClean, startTempScan, useTempCleanup, type TempJob } from './tempCleanupStore'

const AGE_OPTIONS = [
  { value: '0', label: 'Any time' },
  { value: '1', label: '1+ day' },
  { value: '3', label: '3+ days' },
  { value: '7', label: '7+ days' },
  { value: '30', label: '30+ days' },
]

/** Idle time that keeps recent work safe: nothing newer than this is offered by default. */
export const DEFAULT_IDLE_DAYS = 7

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

/** Overlay: the dialog, mounted only while open. */
export function TempCleanupOverlay() {
  const open = useTempCleanup((s) => s.open)
  const setOpen = useTempCleanup((s) => s.setOpen)
  if (!open) return null
  return <TempCleanupDialog onClose={() => setOpen(false)} />
}

/** How much of `group` Delete removes at the chosen idle time; muted when that is nothing. */
function IdleCell({ group, days }: { group: TempGroup; days: number }) {
  const part = deletable(group, days)
  return (
    <td
      className={part.entries ? 'px-2 py-1 text-right' : 'px-2 py-1 text-right text-[var(--fg-muted)]'}
      data-testid="temp-cleanup-idle"
    >
      {part.entries ? `${part.entries} · ${formatBytes(part.bytes)}` : 'none'}
    </td>
  )
}

/** The footer text of a running job. */
function jobMessage(job: TempJob): string {
  if (job.cancelling) return 'Cancelling…'
  const verb = job.kind === 'scan' ? 'Scanning' : 'Deleting'
  return `${verb}: ${progressText(job.progress, 'entries', job.kind === 'scan' ? 'found' : 'freed')}`
}

/**
 * Clean Temp Files: the kinds of entry in the OS temp folder (folders by name, loose files by
 * extension) with their sizes, biggest first. Opening the dialog reads nothing: scanning a large
 * temp folder takes a while, so it runs only when asked.
 * Deleting removes the ticked kinds' entries that have not changed for the chosen time; whatever
 * is locked or refused is skipped and reported. A scan or delete keeps running when the dialog is
 * hidden: the status bar's Background Tasks shows it, with Cancel.
 */
export function TempCleanupDialog({ onClose }: { onClose: () => void }) {
  const groups = useTempCleanup((s) => s.groups)
  const scannedAt = useTempCleanup((s) => s.scannedAt)
  const job = useTempCleanup((s) => s.job)
  const status = useTempCleanup((s) => s.status)
  const error = useTempCleanup((s) => s.error)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [days, setDays] = useState(DEFAULT_IDLE_DAYS)
  const [confirming, setConfirming] = useState(false)
  const busy = job !== null

  const toggle = (key: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const run = () => {
    setConfirming(false)
    const keys = [...selected]
    setSelected(new Set())
    void startTempClean(keys, days)
  }

  const all = groups ?? []
  const chosen = all.filter((group) => selected.has(group.key))
  const total = all.reduce((sum, group) => sum + group.bytes, 0)
  // What the ticked kinds lose at the chosen idle time: an agent's temp folders are rarely a week
  // old, and a Delete that then "removed 0, kept N" read as a clean-up that does not work.
  const toDelete = deletableTotal(all, selected, days)
  const idleLabel = days === 0 ? 'any time' : `${days}+ days`
  const nothingOldEnough = chosen.length > 0 && toDelete.entries === 0
  const buttons: DialogButton[] = confirming
    ? [
        { label: 'Delete Permanently', role: 'default', onClick: run },
        { label: 'Back', role: 'cancel', onClick: () => setConfirming(false) },
      ]
    : busy
      ? [
          { label: 'Run in Background', role: 'default', onClick: onClose },
          { label: 'Cancel', role: 'cancel', disabled: job.cancelling, onClick: cancelTempJobNow },
        ]
      : [{ label: 'Close', role: 'cancel', onClick: onClose }]

  const message = job
    ? jobMessage(job)
    : confirming
      ? `Delete ${plural(toDelete.entries, 'entry')} (${formatBytes(toDelete.bytes)}) of ${plural(chosen.length, 'kind')} idle for ${idleLabel}? This cannot be undone.`
      : nothingOldEnough
        ? `Nothing in the ticked kinds has been idle for ${idleLabel}. Choose a shorter time under Idle for.`
        : (status ?? (groups ? `${formatBytes(total)} in ${plural(all.length, 'kind')} of entry.` : 'Press Scan to list the temp folder.'))

  return (
    <Dialog
      open
      // Closing while a job runs hides the dialog; the job goes on in the status bar.
      onClose={onClose}
      title="Clean Temp Files"
      width={720}
      minHeight={360}
      resizable="both"
      keepInside
      buttons={buttons}
      footerStart={
        <span className="flex min-w-0 items-center gap-2">
          {busy && <Spinner label={job.kind === 'scan' ? 'Scanning' : 'Deleting'} />}
          <span className={confirming ? 'text-[var(--danger)]' : 'truncate text-[var(--fg-muted)]'} data-testid="temp-cleanup-status">
            {message}
          </span>
        </span>
      }
      footer={
        confirming || busy ? null : (
          <Button icon="trash" disabled={toDelete.entries === 0} onClick={() => setConfirming(true)} data-testid="temp-cleanup-delete">
            Delete…
          </Button>
        )
      }
    >
      <div className="flex h-[380px] min-h-0 flex-col gap-3 px-4 pb-1 pt-3" data-testid="temp-cleanup-dialog">
        <div className="flex items-center gap-3 border-b border-[var(--border)] pb-3">
          <span className="text-[var(--fg-muted)]">Idle for:</span>
          <Select
            aria-label="Idle for"
            value={String(days)}
            disabled={busy}
            options={AGE_OPTIONS}
            onChange={(value) => setDays(Number(value))}
          />
          <span className="flex-1" />
          <Button icon="refresh" disabled={busy} onClick={() => void startTempScan()} data-testid="temp-cleanup-rescan">
            {groups ? 'Rescan' : 'Scan'}
          </Button>
        </div>
        {job?.kind === 'scan' && job.progress && job.progress.total > 0 && (
          <div className="h-1 overflow-hidden rounded bg-[var(--border)]" data-testid="temp-cleanup-progress">
            <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round((job.progress.done / job.progress.total) * 100)}%` }} />
          </div>
        )}
        {error && <span className="text-[var(--danger)]">{error}</span>}
        <div className="min-h-0 flex-1 overflow-auto rounded border border-[var(--border)]">
          <table className="w-full table-fixed border-collapse text-[12px]">
            <thead className="sticky top-0 bg-[var(--bg-dialog)] text-left text-[var(--fg-muted)]">
              <tr className="border-b border-[var(--border)]">
                <th className="w-[28px] px-2 py-1">
                  <Checkbox
                    aria-label="Select all"
                    checked={all.length > 0 && chosen.length === all.length}
                    indeterminate={chosen.length > 0 && chosen.length < all.length}
                    disabled={busy || !all.length}
                    onChange={(on) => setSelected(on ? new Set(all.map((group) => group.key)) : new Set())}
                  />
                </th>
                <th className="px-2 py-1 font-normal">Kind</th>
                <th className="w-[80px] px-2 py-1 text-right font-normal">Entries</th>
                <th className="w-[90px] px-2 py-1 text-right font-normal">Size</th>
                <th className="w-[130px] px-2 py-1 text-right font-normal" title="What Delete removes at the chosen idle time">
                  Idle {idleLabel}
                </th>
                <th className="w-[110px] px-2 py-1 text-right font-normal">Newest</th>
              </tr>
            </thead>
            <tbody>
              {all.map((group) => (
                <tr key={group.key} className="border-b border-[var(--border)]" data-testid="temp-cleanup-row">
                  <td className="px-2 py-1">
                    <Checkbox
                      aria-label={`Select ${group.key}`}
                      checked={selected.has(group.key)}
                      disabled={busy}
                      onChange={(on) => toggle(group.key, on)}
                    />
                  </td>
                  <td className="truncate px-2 py-1" title={group.key}>{group.key}</td>
                  <td className="px-2 py-1 text-right">{group.entries}</td>
                  <td className="px-2 py-1 text-right">{formatBytes(group.bytes)}</td>
                  <IdleCell group={group} days={days} />
                  <td className="px-2 py-1 text-right">{daysSince(group.newest, scannedAt)}d ago</td>
                </tr>
              ))}
            </tbody>
          </table>
          {groups && !all.length && (
            <div className="px-6 py-8 text-center text-[var(--fg-muted)]">The temp folder is empty.</div>
          )}
        </div>
      </div>
    </Dialog>
  )
}
