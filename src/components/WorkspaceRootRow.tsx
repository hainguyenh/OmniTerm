import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight, FolderGit2, Terminal, Trash2 } from 'lucide-react'
import type { Workspace } from '@omniterm/contract'

interface WorkspaceRootRowProps {
  workspace: Workspace
  expanded: boolean
  connectionAction: ReactNode
  onToggle: () => void
  onOpenTerminal: () => void
  onRemove: () => void
}

export default function WorkspaceRootRow({
  workspace,
  expanded,
  connectionAction,
  onToggle,
  onOpenTerminal,
  onRemove,
}: WorkspaceRootRowProps) {
  return (
    <div
      className="group flex items-center gap-1 px-2 py-1.5 mx-1 rounded cursor-pointer hover:bg-[var(--theme-hover-bg)]"
      onClick={onToggle}
      title={workspace.path}
    >
      {expanded
        ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-[var(--theme-dim)]" />
        : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-[var(--theme-dim)]" />}
      <FolderGit2 className="w-4 h-4 flex-shrink-0 text-[var(--theme-accent)]" />
      <span className="flex-1 truncate text-sm">{workspace.name}</span>
      <button
        type="button"
        title="Open terminal here"
        onClick={(event) => { event.stopPropagation(); onOpenTerminal() }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--theme-bg)] text-[var(--theme-dim)] hover:text-[var(--theme-fg)] transition"
      >
        <Terminal className="w-3.5 h-3.5" />
      </button>
      {connectionAction}
      <button
        type="button"
        title="Remove from workspaces"
        onClick={(event) => { event.stopPropagation(); onRemove() }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--theme-bg)] text-[var(--theme-dim)] hover:text-red-400 transition"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
