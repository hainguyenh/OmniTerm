import React from 'react'
import {
  Check,
  ChevronDown,
  ClipboardCopy,
  Globe,
  RotateCw,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'

import { Tooltip } from '../../../ui/components/Tooltip'
import type { LaunchRunSummary } from '../src/types'
import { LaunchFilterInput } from './LaunchFilterInput'

export interface LaunchConsoleToolbarProps {
  filterText: string
  onFilterChange: (val: string) => void
  activeRun: LaunchRunSummary | null
  isRunning: boolean
  activeRunBrowserUrl: string | null
  copiedLogs: boolean
  onOpenBrowser: (url: string) => void
  onOpenInTerminal: () => void
  onCopyLogs: (e: React.MouseEvent) => void
  onRestart: () => void
  onStop: () => void
  onClearOutput: () => void
  onClose: () => void
}

export const LaunchConsoleToolbar: React.FC<LaunchConsoleToolbarProps> = ({
  filterText,
  onFilterChange,
  activeRun,
  isRunning,
  activeRunBrowserUrl,
  copiedLogs,
  onOpenBrowser,
  onOpenInTerminal,
  onCopyLogs,
  onRestart,
  onStop,
  onClearOutput,
  onClose,
}) => {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <LaunchFilterInput value={filterText} onChange={onFilterChange} />

      {activeRunBrowserUrl && (
        <Tooltip content={`Open ${activeRunBrowserUrl} in browser`} placement="top">
          <button
            type="button"
            aria-label={`Open ${activeRunBrowserUrl} in browser`}
            onClick={() => onOpenBrowser(activeRunBrowserUrl)}
            className="p-1 rounded text-theme-accent hover:text-theme-fg hover:bg-theme-hover transition-colors"
          >
            <Globe className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      )}

      {activeRun && (
        <>
          <Tooltip content="Open as interactive Terminal Tab" placement="top">
            <button
              type="button"
              aria-label="Pop out to terminal tab"
              onClick={onOpenInTerminal}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-theme-dim hover:text-theme-fg hover:bg-theme-hover transition-colors"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Terminal Tab</span>
            </button>
          </Tooltip>

          <Tooltip content={copiedLogs ? 'Copied logs!' : 'Copy logs to clipboard'} placement="top">
            <button
              type="button"
              aria-label="Copy displayed output"
              onClick={onCopyLogs}
              className="p-1 rounded text-theme-dim hover:text-theme-fg hover:bg-theme-hover transition-colors"
            >
              {copiedLogs ? (
                <Check className="w-3.5 h-3.5 text-theme-success" />
              ) : (
                <ClipboardCopy className="w-3.5 h-3.5" />
              )}
            </button>
          </Tooltip>

          <Tooltip content={`Restart ${activeRun.name}`} placement="top">
            <button
              type="button"
              aria-label={`Restart ${activeRun.name}`}
              onClick={onRestart}
              className="p-1 rounded text-theme-dim hover:text-theme-fg hover:bg-theme-hover transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </Tooltip>

          <Tooltip
            content={isRunning ? `Stop ${activeRun.name}` : `Run not active (${activeRun.status})`}
            placement="top"
          >
            <button
              type="button"
              disabled={!isRunning}
              aria-label={`Stop ${activeRun.name}`}
              onClick={onStop}
              className="p-1 rounded text-theme-error hover:bg-theme-error/15 transition-colors disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          </Tooltip>

          <Tooltip content="Clear output" placement="top">
            <button
              type="button"
              aria-label="Clear displayed output"
              onClick={onClearOutput}
              className="p-1 rounded text-theme-dim hover:text-theme-fg hover:bg-theme-hover transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </>
      )}

      <Tooltip content="Minimize console (runs continue in background)" placement="top">
        <button
          type="button"
          aria-label="Minimize launch console"
          onClick={onClose}
          className="p-1 rounded text-theme-dim hover:text-theme-fg hover:bg-theme-hover transition-colors"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </Tooltip>

      <Tooltip content="Close console" placement="top">
        <button
          type="button"
          aria-label="Close launch console"
          onClick={onClose}
          className="p-1 rounded text-theme-dim hover:text-theme-error hover:bg-theme-hover transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </Tooltip>
    </div>
  )
}

export default LaunchConsoleToolbar
