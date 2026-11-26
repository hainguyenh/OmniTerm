import { useMemo, useState } from 'react'

import { Button, Checkbox, Select } from '../../ide/ui'
import { progressText } from '../cleanupJob'
import { formatBytes } from '../sessions/sessionCleanupModel'

import { ConfirmBar, EmptyNote, JobLine } from './CleanupParts'
import { CleanupRootsBar } from './CleanupRootsBar'
import { freeable, idleDays, idleTargets, type RustCleanMode, type RustTarget } from './rustCleanupModel'
import { cancelRustJobNow, startRustClean, startRustScan, useRustCleanup, type RustJob } from './rustCleanupStore'

const IDLE_OPTIONS = [
  { value: '0', label: 'Any time' },
  { value: '7', label: 'Not built 7+ days' },
  { value: '30', label: 'Not built 30+ days' },
  { value: '90', label: 'Not built 90+ days' },
]

const MODE_TEXT: Record<RustCleanMode, { button: string; what: string; effect: string }> = {
  incremental: {
    button: 'Delete Cache…',
    what: 'the incremental caches of',
    effect: 'The next build of each is a little slower.',
  },
  all: {
    button: 'Delete target…',
    what: 'the whole target folder of',
    effect: 'Each is rebuilt from scratch next time, like after cargo clean.',
  },
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

function jobLabel(job: RustJob): string {
  const verb = job.kind === 'scan' ? 'Scanning' : 'Deleting'
  return `${verb}: ${progressText(job.progress, job.kind === 'scan' ? 'projects' : 'folders', job.kind === 'scan' ? 'found' : 'freed')}`
}

function TargetRow({ target, now, checked, disabled, onToggle }: {
  target: RustTarget
  now: number
  checked: boolean
  disabled: boolean
  onToggle: (on: boolean) => void
}) {
  const days = idleDays(target, now)
  return (
    <li className="flex items-start gap-2 border-b border-[var(--border)] px-2 py-1.5" data-testid="rust-cleanup-row">
      <Checkbox aria-label={`Select ${target.name}`} checked={checked} disabled={disabled} onChange={onToggle} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-semibold" title={target.project}>{target.name}</span>
          <span className="ml-auto shrink-0 tabular-nums">{formatBytes(target.bytes)}</span>
        </div>
        <div className="truncate text-[11px] text-[var(--fg-muted)]" title={target.target}>
          {`${days === 0 ? 'Built today' : `Built ${days}d ago`} · cache ${formatBytes(target.incrementalBytes)} · ${target.project}`}
        </div>
      </div>
    </li>
  )
}

/**
 * Clean Up › Rust: the Cargo build folders under the workspaces and the added folders, biggest
 * first. Deleting removes either the incremental caches (the build output stays) or the whole
 * folder. A scan or clean-up keeps running when the tool window is hidden; the status bar's
 * Background Tasks shows it, with Cancel.
 */
export function RustCleanupPanel() {
  const targets = useRustCleanup((s) => s.targets)
  const scannedAt = useRustCleanup((s) => s.scannedAt)
  const job = useRustCleanup((s) => s.job)
  const status = useRustCleanup((s) => s.status)
  const error = useRustCleanup((s) => s.error)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [days, setDays] = useState(0)
  const [confirming, setConfirming] = useState<RustCleanMode | null>(null)
  const busy = job !== null
  const now = scannedAt || Date.now()

  const shown = useMemo(() => idleTargets(targets ?? [], days, now), [targets, days, now])
  const chosen = shown.filter((target) => selected.has(target.target))
  const chosenKeys = new Set(chosen.map((target) => target.target))
  const total = shown.reduce((sum, target) => sum + target.bytes, 0)

  const toggle = (key: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const run = (mode: RustCleanMode) => {
    setConfirming(null)
    setSelected(new Set())
    void startRustClean([...chosenKeys], mode)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2 text-[12px]" data-testid="rust-cleanup">
      <div className="flex items-center gap-2">
        <Button size="small" icon="refresh" disabled={busy} onClick={() => void startRustScan()} data-testid="rust-cleanup-scan">
          {targets ? 'Rescan' : 'Scan'}
        </Button>
        <Select
          aria-label="Show build folders"
          value={String(days)}
          disabled={busy}
          options={IDLE_OPTIONS}
          onChange={(value) => {
            setDays(Number(value))
            setSelected(new Set())
          }}
        />
      </div>
      <CleanupRootsBar disabled={busy} />
      {job && <JobLine label={jobLabel(job)} progress={job.progress} cancelling={job.cancelling} onCancel={cancelRustJobNow} />}
      {error && <span className="text-[var(--danger)]">{error}</span>}
      <div className="min-h-0 flex-1 overflow-auto rounded border border-[var(--border)]">
        {shown.length > 0 && (
          <div className="sticky top-0 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-island)] px-2 py-1 text-[var(--fg-muted)]">
            <Checkbox
              aria-label="Select all"
              checked={chosen.length === shown.length}
              indeterminate={chosen.length > 0 && chosen.length < shown.length}
              disabled={busy}
              onChange={(on) => setSelected(on ? new Set(shown.map((target) => target.target)) : new Set())}
            />
            <span>{`${plural(shown.length, 'project')} · ${formatBytes(total)}`}</span>
          </div>
        )}
        <ul>
          {shown.map((target) => (
            <TargetRow
              key={target.target}
              target={target}
              now={now}
              checked={selected.has(target.target)}
              disabled={busy}
              onToggle={(on) => toggle(target.target, on)}
            />
          ))}
        </ul>
        {!targets && <EmptyNote>Press Scan to find the Cargo build folders in your workspaces.</EmptyNote>}
        {targets && !targets.length && <EmptyNote>No Cargo build folder found.</EmptyNote>}
        {targets && targets.length > 0 && !shown.length && <EmptyNote>Every build folder was built more recently.</EmptyNote>}
      </div>
      {confirming ? (
        <ConfirmBar
          message={`Delete ${MODE_TEXT[confirming].what} ${plural(chosen.length, 'project')} (${formatBytes(freeable(chosen, chosenKeys, confirming))})? ${MODE_TEXT[confirming].effect}`}
          confirmLabel="Delete Permanently"
          onConfirm={() => run(confirming)}
          onBack={() => setConfirming(null)}
        />
      ) : (
        <>
          {status && !busy && <span className="text-[var(--fg-muted)]" data-testid="rust-cleanup-status">{status}</span>}
          <div className="flex flex-wrap justify-end gap-2">
            {(['incremental', 'all'] as const).map((mode) => (
              <Button
                key={mode}
                size="small"
                icon="trash"
                disabled={busy || freeable(chosen, chosenKeys, mode) === 0}
                onClick={() => setConfirming(mode)}
                data-testid={`rust-cleanup-${mode}`}
              >
                {MODE_TEXT[mode].button}
              </Button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
