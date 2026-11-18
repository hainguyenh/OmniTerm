import { useCallback, useState } from 'react'

import { Button, Checkbox, Dialog, Select, type DialogButton } from '../../ide/ui'
import { Spinner } from '../../ide/ui/Spinner'
import { formatBytes } from '../sessions/sessionCleanupModel'

import { cleanTemp, daysSince, scanTemp, selectedBytes, type TempGroup } from './tempCleanupModel'
import { useTempCleanup } from './tempCleanupStore'

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

/**
 * Clean Temp Files: the kinds of entry in the OS temp folder (folders by name, loose files by
 * extension) with their sizes, biggest first. Opening the dialog reads nothing: scanning a large
 * temp folder is slow, so it runs only when asked.
 * Deleting removes the ticked kinds' entries that have not changed for the chosen time; whatever
 * is locked or refused is skipped and reported. Nothing is read from inside the entries.
 */
export function TempCleanupDialog({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<TempGroup[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [days, setDays] = useState(DEFAULT_IDLE_DAYS)
  const [busy, setBusy] = useState<'scan' | 'clean' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const scan = useCallback(async () => {
    setBusy('scan')
    setError(null)
    try {
      setGroups(await scanTemp())
      setNow(Date.now())
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(null)
    }
  }, [])

  const toggle = (key: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const run = async () => {
    setConfirming(false)
    setBusy('clean')
    try {
      const report = await cleanTemp([...selected], days)
      const skipped = report.skipped.length
        ? ` ${plural(report.skipped.length, 'entry')} skipped (in use or refused): ${report.skipped[0]?.name}.`
        : ''
      setStatus(`Removed ${plural(report.removed, 'entry')}, freed ${formatBytes(report.freedBytes)}; kept ${report.kept}.${skipped}`)
      setSelected(new Set())
      await scan()
    } catch (cause) {
      setError(`Clean-up failed: ${String(cause)}`)
      setBusy(null)
    }
  }

  const all = groups ?? []
  const chosen = all.filter((group) => selected.has(group.key))
  const total = all.reduce((sum, group) => sum + group.bytes, 0)
  const buttons: DialogButton[] = confirming
    ? [
        { label: 'Delete Permanently', role: 'default', onClick: () => void run() },
        { label: 'Back', role: 'cancel', onClick: () => setConfirming(false) },
      ]
    : [{ label: 'Close', role: 'cancel', disabled: busy === 'clean', onClick: onClose }]

  const message = confirming
    ? `Delete entries of ${plural(chosen.length, 'kind')} (up to ${formatBytes(selectedBytes(all, selected))}) idle for ${days === 0 ? 'any time' : `${days}+ days`}? This cannot be undone.`
    : (status ?? (groups ? `${formatBytes(total)} in ${plural(all.length, 'kind')} of entry.` : 'Press Scan to list the temp folder.'))

  return (
    <Dialog
      open
      onClose={busy === 'clean' ? () => undefined : onClose}
      title="Clean Temp Files"
      width={720}
      minHeight={360}
      resizable="both"
      keepInside
      buttons={buttons}
      footerStart={
        <span className="flex min-w-0 items-center gap-2">
          {busy && <Spinner label={busy === 'scan' ? 'Scanning' : 'Deleting'} />}
          <span className={confirming ? 'text-[var(--danger)]' : 'text-[var(--fg-muted)]'} data-testid="temp-cleanup-status">
            {message}
          </span>
        </span>
      }
      footer={
        confirming ? null : (
          <Button icon="trash" disabled={busy !== null || !chosen.length} onClick={() => setConfirming(true)} data-testid="temp-cleanup-delete">
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
            disabled={busy !== null}
            options={AGE_OPTIONS}
            onChange={(value) => setDays(Number(value))}
          />
          <span className="flex-1" />
          <Button icon="refresh" disabled={busy !== null} onClick={() => void scan()} data-testid="temp-cleanup-rescan">
            {groups ? 'Rescan' : 'Scan'}
          </Button>
        </div>
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
                    disabled={busy !== null || !all.length}
                    onChange={(on) => setSelected(on ? new Set(all.map((group) => group.key)) : new Set())}
                  />
                </th>
                <th className="px-2 py-1 font-normal">Kind</th>
                <th className="w-[80px] px-2 py-1 text-right font-normal">Entries</th>
                <th className="w-[90px] px-2 py-1 text-right font-normal">Size</th>
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
                      disabled={busy !== null}
                      onChange={(on) => toggle(group.key, on)}
                    />
                  </td>
                  <td className="truncate px-2 py-1" title={group.key}>{group.key}</td>
                  <td className="px-2 py-1 text-right">{group.entries}</td>
                  <td className="px-2 py-1 text-right">{formatBytes(group.bytes)}</td>
                  <td className="px-2 py-1 text-right">{daysSince(group.newest, now)}d ago</td>
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
