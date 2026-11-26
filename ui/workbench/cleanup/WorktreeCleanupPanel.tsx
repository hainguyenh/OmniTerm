import { useMemo, useState } from 'react'

import { Button, Checkbox, Select } from '../../ide/ui'
import { progressText } from '../cleanupJob'
import { formatBytes } from '../sessions/sessionCleanupModel'

import { ConfirmBar, EmptyNote, JobLine } from './CleanupParts'
import { CleanupRootsBar } from './CleanupRootsBar'
import { sortWorktrees, suggest, type Suggestion, type Verdict, type WorktreeEntry } from './worktreeCleanupModel'
import { cancelWorktreeScanNow, startWorktreeRemove, startWorktreeScan, useWorktreeCleanup, type WorktreeJob } from './worktreeCleanupStore'

type Show = 'all' | 'suggested'

const VERDICT: Record<Verdict, { label: string; color: string }> = {
  remove: { label: 'Safe to remove', color: 'var(--vcs-added, var(--accent))' },
  review: { label: 'Review', color: 'var(--vcs-modified, var(--fg-muted))' },
  keep: { label: 'Keep', color: 'var(--fg-muted)' },
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

function jobLabel(job: WorktreeJob): string {
  return job.kind === 'scan' ? `Scanning: ${progressText(job.progress, 'worktrees', 'found')}` : 'Removing worktrees…'
}

/** Whether removing `entry` loses work that `--force` would discard. */
const needsForce = (entry: WorktreeEntry) => !entry.missing && (Boolean(entry.changes) || entry.locked)

function WorktreeRow({ entry, suggestion, checked, disabled, onToggle }: {
  entry: WorktreeEntry
  suggestion: Suggestion
  checked: boolean
  disabled: boolean
  onToggle: (on: boolean) => void
}) {
  const verdict = VERDICT[suggestion.verdict]
  const name = entry.branch ?? (entry.head ? `detached ${entry.head.slice(0, 8)}` : 'detached')
  return (
    <div className="flex items-start gap-2 border-b border-[var(--border)] px-2 py-1.5" data-testid="worktree-cleanup-row">
      <Checkbox aria-label={`Select ${entry.path}`} checked={checked} disabled={disabled} onChange={onToggle} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-semibold" title={name}>{name}</span>
          <span className="shrink-0 text-[11px]" style={{ color: verdict.color }} data-testid="worktree-cleanup-verdict">
            {verdict.label}
          </span>
          <span className="ml-auto shrink-0 tabular-nums">{entry.bytes === null ? '—' : formatBytes(entry.bytes)}</span>
        </div>
        <div className="truncate text-[11px] text-[var(--fg-muted)]" title={suggestion.reasons.join(' · ')}>
          {suggestion.reasons.join(' · ')}
        </div>
        <div className="truncate text-[11px] text-[var(--fg-muted)]" title={entry.path}>
          {entry.path}
        </div>
      </div>
    </div>
  )
}

/**
 * Clean Up › Worktrees: the linked worktrees of every repository under the workspaces and the
 * added folders, each with a suggestion from what removing it would lose — uncommitted changes,
 * unpushed or local-only commits mean keep; a branch merged into the main line, or a folder that
 * is already gone, means safe to remove; a deleted remote branch or a long idle time means review.
 * Removing a worktree with uncommitted changes needs its own confirmation.
 */
export function WorktreeCleanupPanel() {
  const entries = useWorktreeCleanup((s) => s.entries)
  const scannedAt = useWorktreeCleanup((s) => s.scannedAt)
  const job = useWorktreeCleanup((s) => s.job)
  const status = useWorktreeCleanup((s) => s.status)
  const error = useWorktreeCleanup((s) => s.error)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [show, setShow] = useState<Show>('all')
  const [deleteBranches, setDeleteBranches] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [discard, setDiscard] = useState(false)
  const busy = job !== null
  const now = scannedAt || Date.now()

  const rows = useMemo(() => {
    const sorted = sortWorktrees(entries ?? [], now).map((entry) => ({ entry, suggestion: suggest(entry, now) }))
    return show === 'suggested' ? sorted.filter((row) => row.suggestion.verdict !== 'keep') : sorted
  }, [entries, now, show])
  const chosen = rows.filter((row) => selected.has(row.entry.path)).map((row) => row.entry)
  const forced = chosen.filter(needsForce)
  const bytes = chosen.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0)
  const safe = rows.filter((row) => row.suggestion.verdict === 'remove').map((row) => row.entry.path)

  const toggle = (key: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const run = () => {
    setConfirming(false)
    setDiscard(false)
    setSelected(new Set())
    void startWorktreeRemove(chosen.map((entry) => entry.path), forced.length > 0, deleteBranches)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2 text-[12px]" data-testid="worktree-cleanup">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="small" icon="refresh" disabled={busy} onClick={() => void startWorktreeScan()} data-testid="worktree-cleanup-scan">
          {entries ? 'Rescan' : 'Scan'}
        </Button>
        <Select
          aria-label="Show worktrees"
          value={show}
          disabled={busy}
          options={[
            { value: 'all', label: 'All worktrees' },
            { value: 'suggested', label: 'Suggested only' },
          ]}
          onChange={(value) => setShow(value === 'suggested' ? 'suggested' : 'all')}
        />
        <Button size="small" disabled={busy || !safe.length} onClick={() => setSelected(new Set(safe))} data-testid="worktree-cleanup-select-safe">
          Select Safe
        </Button>
      </div>
      <CleanupRootsBar disabled={busy} />
      {job && (
        <JobLine
          label={jobLabel(job)}
          progress={job.progress}
          cancelling={job.cancelling}
          onCancel={job.kind === 'scan' ? cancelWorktreeScanNow : undefined}
        />
      )}
      {error && <span className="text-[var(--danger)]">{error}</span>}
      <div className="min-h-0 flex-1 overflow-auto rounded border border-[var(--border)]">
        <div role="list">
          {rows.map(({ entry, suggestion }, index) => (
            <div key={entry.path} role="listitem">
              {(index === 0 || rows[index - 1]?.entry.repo !== entry.repo) && (
                <div className="sticky top-0 border-b border-[var(--border)] bg-[var(--bg-island)] px-2 py-1 font-semibold" title={entry.repo}>
                  {entry.repoName}
                </div>
              )}
              <WorktreeRow
                entry={entry}
                suggestion={suggestion}
                checked={selected.has(entry.path)}
                disabled={busy}
                onToggle={(on) => toggle(entry.path, on)}
              />
            </div>
          ))}
        </div>
        {!entries && <EmptyNote>Press Scan to list the git worktrees of your workspaces.</EmptyNote>}
        {entries && !entries.length && <EmptyNote>No linked worktree found.</EmptyNote>}
        {entries && entries.length > 0 && !rows.length && <EmptyNote>Nothing suggested: every worktree is in use.</EmptyNote>}
      </div>
      {confirming ? (
        <ConfirmBar
          message={`Remove ${plural(chosen.length, 'worktree')} (${formatBytes(bytes)})?${deleteBranches ? ' Their branches are deleted too when merged.' : ''}`}
          confirmLabel="Remove"
          canConfirm={!forced.length || discard}
          onConfirm={run}
          onBack={() => {
            setConfirming(false)
            setDiscard(false)
          }}
        >
          {forced.length > 0 && (
            <Checkbox
              checked={discard}
              onChange={setDiscard}
              label={`Discard the uncommitted changes in ${plural(forced.length, 'worktree')} (${forced.map((entry) => entry.branch ?? entry.path).join(', ')})`}
            />
          )}
        </ConfirmBar>
      ) : (
        <>
          {status && !busy && <span className="text-[var(--fg-muted)]" data-testid="worktree-cleanup-status">{status}</span>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Checkbox checked={deleteBranches} disabled={busy} onChange={setDeleteBranches} label="Delete merged branches" className="mr-auto" />
            <Button size="small" icon="trash" disabled={busy || !chosen.length} onClick={() => setConfirming(true)} data-testid="worktree-cleanup-remove">
              Remove…
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
