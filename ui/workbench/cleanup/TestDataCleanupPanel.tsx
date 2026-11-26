import { useState } from 'react'

import { Button } from '../../ide/ui'
import { formatBytes } from '../sessions/sessionCleanupModel'

import { ConfirmBar, EmptyNote, JobLine } from './CleanupParts'
import { applyTestDataRemovals, removeTestData, scanTestData, type TestDataFolder } from './testDataCleanupModel'

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Clean Up › Test Data: the folders OmniTerm's own test runs (`com.omniterm.tests.<pid>`) left in
 * the per-user data folders after their process ended. Only a machine that runs the test suite
 * has any; the folders of a test run still going are not listed.
 */
export function TestDataCleanupPanel() {
  const [folders, setFolders] = useState<TestDataFolder[] | null>(null)
  const [busy, setBusy] = useState<'scan' | 'remove' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const total = (folders ?? []).reduce((sum, folder) => sum + folder.bytes, 0)

  const scan = async () => {
    setBusy('scan')
    setError(null)
    setStatus(null)
    try {
      setFolders(await scanTestData())
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!folders?.length) return
    setConfirming(false)
    setBusy('remove')
    setError(null)
    try {
      const result = applyTestDataRemovals(folders, await removeTestData(folders.map((folder) => folder.path)))
      setFolders(result.left)
      const failed = result.failed ? `; ${plural(result.failed, 'folder')} could not be removed` : ''
      setStatus(`Removed ${plural(result.removed, 'folder')}, freed ${formatBytes(result.freedBytes)}${failed}.`)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2 text-[12px]" data-testid="test-data-cleanup">
      <div className="flex items-center gap-2">
        <Button size="small" icon="refresh" disabled={busy !== null} onClick={() => void scan()} data-testid="test-data-cleanup-scan">
          {folders ? 'Rescan' : 'Scan'}
        </Button>
        <span className="text-[var(--fg-muted)]">Folders left by OmniTerm test runs that have ended.</span>
      </div>
      {busy && <JobLine label={busy === 'scan' ? 'Scanning…' : 'Removing…'} progress={null} cancelling={false} />}
      {error && <span className="text-[var(--danger)]">{error}</span>}
      <div className="min-h-0 flex-1 overflow-auto rounded border border-[var(--border)]">
        {folders && folders.length > 0 && (
          <div className="sticky top-0 border-b border-[var(--border)] bg-[var(--bg-island)] px-2 py-1 text-[var(--fg-muted)]">
            {`${plural(folders.length, 'folder')} · ${formatBytes(total)}`}
          </div>
        )}
        <ul>
          {(folders ?? []).map((folder) => (
            <li key={folder.path} className="flex items-baseline gap-2 border-b border-[var(--border)] px-2 py-1" data-testid="test-data-cleanup-row">
              <span className="min-w-0 flex-1 truncate" title={folder.path}>{folder.path}</span>
              <span className="shrink-0 tabular-nums text-[var(--fg-muted)]">{formatBytes(folder.bytes)}</span>
            </li>
          ))}
        </ul>
        {!folders && <EmptyNote>Press Scan to find the folders earlier test runs left behind.</EmptyNote>}
        {folders && !folders.length && <EmptyNote>No test run left folders behind.</EmptyNote>}
      </div>
      {confirming ? (
        <ConfirmBar
          message={`Delete ${plural(folders?.length ?? 0, 'folder')} (${formatBytes(total)}) left by ended test runs?`}
          confirmLabel="Delete Permanently"
          onConfirm={() => void remove()}
          onBack={() => setConfirming(false)}
        />
      ) : (
        <>
          {status && !busy && <span className="text-[var(--fg-muted)]" data-testid="test-data-cleanup-status">{status}</span>}
          <div className="flex justify-end">
            <Button
              size="small"
              icon="trash"
              disabled={busy !== null || !folders?.length}
              onClick={() => setConfirming(true)}
              data-testid="test-data-cleanup-remove"
            >
              Delete All…
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
