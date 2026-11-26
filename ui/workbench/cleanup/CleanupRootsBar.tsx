import { open } from '@tauri-apps/plugin-dialog'

import { diag } from '../../diag'
import { IconButton } from '../../ide/ui'

import { MAX_EXTRA_ROOTS, useCleanupRoots } from './cleanupRootsStore'

/** Asks for a folder to search on top of the workspaces. */
async function pickFolder(): Promise<string | null> {
  try {
    const picked = await open({ directory: true, multiple: false, title: 'Add Folder to Search' })
    return typeof picked === 'string' ? picked : null
  } catch (error) {
    diag.error('[CleanUp] folder picker failed', error)
    return null
  }
}

/** Where Rust and Worktrees search: every workspace folder, plus the folders added here. */
export function CleanupRootsBar({ disabled }: { disabled: boolean }) {
  const roots = useCleanupRoots((s) => s.roots)
  const add = useCleanupRoots((s) => s.add)
  const remove = useCleanupRoots((s) => s.remove)
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px]" data-testid="cleanup-roots">
      <span className="text-[var(--fg-muted)]">Search in:</span>
      <span className="rounded border border-[var(--border)] px-1.5 py-px" title="Every enabled folder of every workspace">
        Workspaces
      </span>
      {roots.map((root) => (
        <span key={root} className="flex min-w-0 max-w-full items-center gap-0.5 rounded border border-[var(--border)] pl-1.5" title={root}>
          <span className="truncate">{root}</span>
          <IconButton icon="close" size="small" title={`Stop searching ${root}`} disabled={disabled} onClick={() => remove(root)} />
        </span>
      ))}
      <IconButton
        icon="plus"
        size="small"
        title="Add Folder to Search…"
        disabled={disabled || roots.length >= MAX_EXTRA_ROOTS}
        onClick={() => void pickFolder().then((root) => root && add(root))}
        data-testid="cleanup-roots-add"
      />
    </div>
  )
}
