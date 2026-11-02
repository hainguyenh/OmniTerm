import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Bug,
  FolderGit2,
  Layers,
  Play,
  RefreshCw,
  Search,
  Square,
  Terminal,
} from 'lucide-react'

import type {
  DiscoveryResult,
  EditorKind,
  LaunchRunMode,
  LaunchRunSummary,
} from '../src/types'

import { LaunchConfigRow } from './LaunchConfigRow'
import {
  ensureDiscovered,
  openConsoleForRun,
  setDefaultLaunchMode,
  startCompound,
  startConfigs,
  stopAllInRoot,
  useLaunchStore,
} from './launchStore'

interface LaunchDropdownPopoverProps {
  rootDir: string
  anchorRect: DOMRect
  discovery: DiscoveryResult
  runsInRoot: LaunchRunSummary[]
  onClose: () => void
}

const EMPTY_SELECTED_IDS: readonly string[] = []

function copyTextToClipboard(text: string): void {
  if (window.omnitermAPI?.clipboard?.writeText) {
    void window.omnitermAPI.clipboard.writeText(text)
    return
  }
  void navigator.clipboard?.writeText?.(text)
}

export function LaunchDropdownPopover({
  rootDir,
  anchorRect,
  discovery,
  runsInRoot,
  onClose,
}: LaunchDropdownPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const defaultMode = useLaunchStore((s) => s.defaultMode)
  const editors = useLaunchStore((s) => s.editors)
  const lastError = useLaunchStore((s) => s.lastError)
  const selectedIds = useLaunchStore((s) => s.selectedByRoot[rootDir] ?? EMPTY_SELECTED_IDS)
  const [query, setQuery] = useState('')
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const preferredEditor: EditorKind = editors.includes('codium') ? 'codium' : 'code'
  const editorLabel = preferredEditor === 'codium' ? 'VSCodium' : 'VS Code'

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const totalConfigCount = useMemo(
    () =>
      discovery.compounds.length +
      discovery.files.reduce((sum, file) => sum + file.configurations.filter((c) => c.runnable).length, 0),
    [discovery],
  )

  const normalizedQuery = query.trim().toLowerCase()
  const filteredCompounds = useMemo(
    () =>
      discovery.compounds.filter(
        (c) =>
          !normalizedQuery ||
          c.name.toLowerCase().includes(normalizedQuery) ||
          c.relativeFolder.toLowerCase().includes(normalizedQuery),
      ),
    [discovery.compounds, normalizedQuery],
  )

  const filteredFiles = useMemo(
    () =>
      discovery.files
        .map((file) => ({
          ...file,
          runnableConfigs: file.configurations.filter(
            (cfg) =>
              cfg.runnable !== false &&
              (!normalizedQuery ||
                cfg.name.toLowerCase().includes(normalizedQuery) ||
                cfg.type.toLowerCase().includes(normalizedQuery) ||
                file.relativeFolder.toLowerCase().includes(normalizedQuery)),
          ),
        }))
        .filter((file) => file.runnableConfigs.length > 0 || (Boolean(file.error) && !normalizedQuery)),
    [discovery.files, normalizedQuery],
  )

  const liveRunsByConfig = useMemo(() => {
    const map = new Map<string, LaunchRunSummary>()
    for (const run of runsInRoot) {
      const isLive = run.status === 'starting' || run.status === 'running'
      if (isLive && !map.has(run.configId)) map.set(run.configId, run)
    }
    return map
  }, [runsInRoot])

  const latestRunByConfig = useMemo(() => {
    const map = new Map<string, LaunchRunSummary>()
    for (const run of runsInRoot) {
      if (!map.has(run.configId)) map.set(run.configId, run)
    }
    return map
  }, [runsInRoot])

  const liveCount = liveRunsByConfig.size
  const popoverWidth = 376
  const maxHeight = Math.min(440, Math.max(200, window.innerHeight - 24))
  const left = Math.max(8, Math.min(anchorRect.right - popoverWidth, window.innerWidth - popoverWidth - 8))
  const opensAbove = anchorRect.bottom + 6 + maxHeight > window.innerHeight && anchorRect.top > maxHeight

  const handleCopyAttach = (run: LaunchRunSummary) => {
    const payload = run.attach?.attachJson ?? run.attach?.wsUrl ?? String(run.pid ?? '')
    if (!payload) return
    copyTextToClipboard(payload)
    setCopiedRunId(run.runId)
    setTimeout(() => setCopiedRunId((curr) => (curr === run.runId ? null : curr)), 1_500)
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await ensureDiscovered(rootDir, true)
    } finally {
      setRefreshing(false)
    }
  }

  const handleBatchLaunch = (mode: LaunchRunMode) => {
    if (selectedIds.length === 0) return
    void startConfigs(rootDir, selectedIds, mode)
  }

  return createPortal(
    <div
      ref={popoverRef}
      data-testid="pane-launch-popover"
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-50 flex flex-col rounded-xl border border-theme-border bg-theme-popup text-theme-fg select-none"
      style={{
        width: Math.min(popoverWidth, window.innerWidth - 16),
        left,
        maxHeight,
        ...(opensAbove
          ? { bottom: window.innerHeight - anchorRect.top + 6 }
          : { top: anchorRect.bottom + 6 }),
      }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-theme-border px-3 py-2">
        <div className="flex items-center rounded-md bg-theme-bg p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setDefaultLaunchMode('run')}
            className={`inline-flex items-center justify-center gap-1 rounded px-2 py-0.5 font-medium leading-none transition-colors ${
              defaultMode === 'run' ? 'bg-theme-popup text-theme-fg' : 'text-theme-dim hover:text-theme-fg'
            }`}
          >
            <Play className="w-3 h-3 shrink-0 text-theme-success" />
            <span className="leading-none translate-y-px">Run</span>
          </button>
          <button
            type="button"
            onClick={() => setDefaultLaunchMode('debug')}
            className={`inline-flex items-center justify-center gap-1 rounded px-2 py-0.5 font-medium leading-none transition-colors ${
              defaultMode === 'debug' ? 'bg-theme-popup text-theme-fg' : 'text-theme-dim hover:text-theme-fg'
            }`}
          >
            <Bug className="w-3 h-3 shrink-0 text-theme-warning" />
            <span className="leading-none translate-y-px">Debug</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          {liveCount > 0 && (
            <button
              type="button"
              onClick={() => void stopAllInRoot(rootDir)}
              className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium leading-none text-theme-error hover:bg-theme-error/15 transition-colors"
            >
              <Square className="w-3 h-3 shrink-0" />
              <span className="leading-none translate-y-px">Stop All</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleRefresh()}
            aria-label="Rescan launch.json files"
            title="Rescan .vscode/launch.json"
            className="w-6 h-6 flex items-center justify-center rounded text-theme-dim hover:bg-theme-hover hover:text-theme-fg transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {totalConfigCount > 5 && (
        <div className="border-b border-theme-border px-3 py-1.5">
          <div className="flex items-center gap-1.5 rounded-md bg-theme-bg px-2 py-1">
            <Search className="w-3.5 h-3.5 text-theme-dim flex-shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter launches or subfolders…"
              className="w-full bg-transparent text-xs text-theme-fg placeholder:text-theme-dim focus:outline-none"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-1.5 space-y-2 custom-scrollbar">
        {lastError && (
          <div className="mx-1.5 flex items-start gap-1.5 rounded-md bg-theme-error/10 px-2.5 py-1.5 text-[11px] text-theme-error">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span className="break-words">{lastError}</span>
          </div>
        )}
        {filteredCompounds.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-theme-dim">
              <Layers className="w-3 h-3" />
              <span>Compounds</span>
            </div>
            <div className="space-y-0.5">
              {filteredCompounds.map((compound) => (
                <div
                  key={compound.id}
                  className="flex items-center gap-2 rounded-md px-2.5 py-1.5 hover:bg-theme-hover/60 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-theme-fg">{compound.name}</span>
                      <span className="rounded bg-theme-bg/80 px-1.5 py-0.5 text-[10px] tabular-nums text-theme-dim">
                        {compound.configIds.length} targets
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={compound.configIds.length === 0}
                    onClick={() => void startCompound(rootDir, compound.id, 'run')}
                    aria-label={`Run compound ${compound.name}`}
                    title="Start Compound Without Debugging"
                    className="w-6 h-6 flex items-center justify-center rounded text-theme-dim hover:bg-theme-hover hover:text-theme-success disabled:opacity-40 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={compound.configIds.length === 0}
                    onClick={() => void startCompound(rootDir, compound.id, 'debug')}
                    aria-label={`Debug compound ${compound.name}`}
                    title="Start Compound in Debug Mode"
                    className="w-6 h-6 flex items-center justify-center rounded text-theme-dim hover:bg-theme-hover hover:text-theme-warning disabled:opacity-40 transition-colors"
                  >
                    <Bug className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {filteredFiles.map((file) => (
          <div key={file.launchJsonPath}>
            <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-theme-dim">
              <FolderGit2 className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">
                {file.relativeFolder === '.' ? 'Root (.vscode/launch.json)' : file.relativeFolder}
              </span>
            </div>
            {file.error ? (
              <div className="mx-2 my-1 flex items-start gap-1.5 rounded-md bg-theme-error/10 px-2.5 py-1.5 text-[11px] text-theme-error">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span className="break-words">{file.error}</span>
              </div>
            ) : (
              <div className="space-y-0.5">
                {file.runnableConfigs.map((cfg) => (
                  <LaunchConfigRow
                    key={cfg.id}
                    rootDir={rootDir}
                    cfg={cfg}
                    checked={selectedIds.includes(cfg.id)}
                    liveRun={liveRunsByConfig.get(cfg.id)}
                    latestRun={latestRunByConfig.get(cfg.id)}
                    preferredEditor={preferredEditor}
                    editorLabel={editorLabel}
                    copiedRunId={copiedRunId}
                    onCopyAttach={handleCopyAttach}
                    onClosePopover={onClose}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-theme-border px-3 py-2 bg-theme-bg/40 rounded-b-xl">
        <button
          type="button"
          data-testid="launch-selected-button"
          disabled={selectedIds.length === 0}
          onClick={() => handleBatchLaunch(defaultMode)}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-theme-accent/15 px-2.5 py-1 text-xs font-medium leading-none text-theme-accent hover:bg-theme-accent/25 disabled:opacity-40 disabled:pointer-events-none transition-colors tabular-nums"
        >
          {defaultMode === 'debug' ? (
            <Bug className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <Play className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="leading-none translate-y-px">
            {selectedIds.length > 0
              ? `${defaultMode === 'debug' ? 'Debug' : 'Launch'} ${selectedIds.length} Selected`
              : 'Select to Batch Launch'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            openConsoleForRun(runsInRoot[0]?.runId)
            onClose()
          }}
          className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs leading-none text-theme-dim hover:bg-theme-hover hover:text-theme-fg transition-colors tabular-nums"
        >
          <Terminal className="w-3.5 h-3.5 shrink-0" />
          <span className="leading-none translate-y-px">
            Console{runsInRoot.length > 0 ? ` (${runsInRoot.length})` : ''}
          </span>
        </button>
      </div>
    </div>,
    document.body,
  )
}
