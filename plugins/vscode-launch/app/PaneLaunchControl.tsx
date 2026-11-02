import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bug, ChevronDown, Play } from 'lucide-react'

import { Tooltip } from '../../../ui/components/Tooltip'
import { LaunchDropdownPopover } from './LaunchDropdownPopover'
import { ensureDiscovered, useLaunchStore } from './launchStore'

export interface PaneLaunchControlProps {
  folderPath?: string
  menuItem?: boolean
}

function normalizeRootKey(rawPath: string): string {
  return rawPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function PaneLaunchControl({ folderPath, menuItem }: PaneLaunchControlProps) {
  const trimmedPath = folderPath?.trim() || undefined
  const available = useLaunchStore((s) => s.available)
  const discovery = useLaunchStore((s) => (trimmedPath ? s.discoveries[trimmedPath] : undefined))
  const allRuns = useLaunchStore((s) => s.runs)
  const [open, setOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!available || !trimmedPath) return
    void ensureDiscovered(trimmedPath)
  }, [available, trimmedPath])

  const runsInRoot = useMemo(() => {
    if (!trimmedPath) return []
    const norm = normalizeRootKey(trimmedPath)
    return allRuns.filter((run) => {
      const rNorm = normalizeRootKey(run.rootDir)
      return rNorm === norm || norm.startsWith(`${rNorm}/`) || rNorm.startsWith(`${norm}/`)
    })
  }, [allRuns, trimmedPath])

  const runnableCount = useMemo(() => {
    if (!discovery) return 0
    return discovery.files.reduce(
      (sum, file) => sum + file.configurations.filter((cfg) => cfg.runnable).length,
      0,
    )
  }, [discovery])

  if (!available || !trimmedPath || !discovery) return null
  if (runnableCount === 0 && discovery.compounds.length === 0 && runsInRoot.length === 0) {
    return null
  }

  const liveRuns = runsInRoot.filter((r) => r.status === 'starting' || r.status === 'running')
  const debugRuns = liveRuns.filter((r) => r.mode === 'debug')
  const hasRecentFailure = liveRuns.length === 0 && runsInRoot[0]?.status === 'failed'

  let toneClass = 'text-theme-dim hover:bg-theme-hover hover:text-theme-accent'
  let label = `Launch (${runnableCount})`
  let icon = <Play className="w-2.5 h-2.5 flex-shrink-0" />

  if (debugRuns.length > 0) {
    toneClass = 'bg-theme-warning/15 text-theme-warning hover:bg-theme-warning/25'
    label = `${debugRuns.length} debug`
    icon = <Bug className="w-2.5 h-2.5 flex-shrink-0" />
  } else if (liveRuns.length > 0) {
    toneClass = 'bg-theme-success/15 text-theme-success hover:bg-theme-success/25'
    label = `${liveRuns.length} running`
    icon = <span className="w-1.5 h-1.5 rounded-full bg-theme-success flex-shrink-0" />
  } else if (hasRecentFailure) {
    toneClass = 'bg-theme-error/15 text-theme-error hover:bg-theme-error/25'
    label = 'Failed'
    icon = <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" />
  }

  if (menuItem) {
    const menuLabel = debugRuns.length > 0
      ? `Launch (${debugRuns.length} debug)`
      : liveRuns.length > 0
        ? `Launch (${liveRuns.length} running)`
        : hasRecentFailure
          ? 'Launch (failed)'
          : `Launch (${runnableCount})`

    const menuIcon = debugRuns.length > 0 ? (
      <Bug className="w-4 h-4 flex-shrink-0 text-theme-warning" />
    ) : liveRuns.length > 0 ? (
      <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-theme-success" />
      </span>
    ) : hasRecentFailure ? (
      <AlertTriangle className="w-4 h-4 flex-shrink-0 text-theme-error" />
    ) : (
      <Play className="w-4 h-4 flex-shrink-0 text-theme-dim" />
    )

    return (
      <>
        <button
          type="button"
          role="menuitem"
          data-testid="pane-launch-menu-item"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="VS Code launch configurations"
          onClick={(e) => {
            e.stopPropagation()
            setAnchorRect(e.currentTarget.getBoundingClientRect())
            setOpen((prev) => !prev)
          }}
          className="flex w-full items-center gap-2 rounded-md bg-theme-popup px-2 py-1.5 text-left text-xs text-theme-fg hover:bg-theme-hover"
        >
          {menuIcon}
          <span>{menuLabel}</span>
        </button>
        {open && anchorRect && (
          <LaunchDropdownPopover
            rootDir={trimmedPath}
            anchorRect={anchorRect}
            discovery={discovery}
            runsInRoot={runsInRoot}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    )
  }

  return (
    <>
      <Tooltip content="VS Code launch.json configurations" placement="bottom">
        <button
          type="button"
          data-testid="pane-launch-trigger"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="VS Code launch configurations"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            setAnchorRect(e.currentTarget.getBoundingClientRect())
            setOpen((prev) => !prev)
          }}
          className={`h-4 px-1.5 inline-flex flex-shrink-0 items-center justify-center gap-1 rounded text-[10px] font-medium tabular-nums leading-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-theme-accent cursor-pointer ${toneClass}`}
        >
          {icon}
          <span className="truncate max-w-[5.5rem] leading-none translate-y-[0.5px]">{label}</span>
          <ChevronDown className="w-2.5 h-2.5 flex-shrink-0 opacity-75" />
        </button>
      </Tooltip>
      {open && anchorRect && (
        <LaunchDropdownPopover
          rootDir={trimmedPath}
          anchorRect={anchorRect}
          discovery={discovery}
          runsInRoot={runsInRoot}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
