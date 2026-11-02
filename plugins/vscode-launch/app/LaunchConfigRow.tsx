import {
  Bug,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Play,
  RotateCw,
  Square,
  Terminal,
} from 'lucide-react'

import { Tooltip } from '../../../ui/components/Tooltip'
import { openExternalUrl, resolveBrowserUrl } from './openUrl'

import type {
  EditorKind,
  LaunchConfigItem,
  LaunchRunSummary,
} from '../src/types'

import {
  getRegisteredLaunchApi,
  openConsoleForRun,
  restartRun,
  startConfigs,
  stopRuns,
  toggleSelectedConfig,
} from './launchStore'

export interface LaunchConfigRowProps {
  rootDir: string
  cfg: LaunchConfigItem
  checked: boolean
  liveRun?: LaunchRunSummary
  latestRun?: LaunchRunSummary
  preferredEditor: EditorKind
  editorLabel: string
  copiedRunId: string | null
  onCopyAttach: (run: LaunchRunSummary) => void
  onClosePopover: () => void
}

function formatAttachBadge(run: LaunchRunSummary): string | null {
  if (run.attach?.port) return `DAP :${run.attach.port}`
  if (run.listeningUrls[0]) {
    try {
      const parsed = new URL(run.listeningUrls[0])
      return `:${parsed.port || '80'}`
    } catch {
      return null
    }
  }
  if (run.pid) return `PID ${run.pid}`
  return null
}

const ICON_BTN_CLASS =
  'w-6 h-6 flex items-center justify-center rounded text-theme-dim hover:bg-theme-hover hover:text-theme-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-theme-accent transition-colors'

export function LaunchConfigRow({
  rootDir,
  cfg,
  checked,
  liveRun,
  latestRun,
  preferredEditor,
  editorLabel,
  copiedRunId,
  onCopyAttach,
  onClosePopover,
}: LaunchConfigRowProps) {
  const badge = liveRun ? formatAttachBadge(liveRun) : null
  const browserUrl = resolveBrowserUrl(liveRun, cfg)

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-theme-hover/60 transition-colors">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => toggleSelectedConfig(rootDir, cfg.id)}
        aria-label={`Select ${cfg.name}`}
        data-terminal-toolbar-switch
        className="flex items-center gap-2 min-w-0 flex-1 text-left rounded cursor-pointer select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-theme-accent"
      >
        <span
          className={`relative h-3.5 w-6 shrink-0 rounded-md transition-colors ${
            checked ? 'bg-theme-accent' : 'bg-theme-border'
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-0.5 h-2.5 w-2.5 rounded-sm bg-white shadow-sm transition-all ${
              checked ? 'left-3' : 'left-0.5'
            }`}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            {liveRun && (
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  liveRun.mode === 'debug' ? 'bg-theme-warning' : 'bg-theme-success'
                }`}
              />
            )}
            <span className="truncate text-xs font-medium text-theme-fg">{cfg.name}</span>
            <span className="flex-shrink-0 rounded bg-theme-bg/80 px-1.5 py-0.5 font-mono text-[10px] text-theme-dim">
              {cfg.type}
            </span>
          </div>
          {liveRun && badge && (
            <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-theme-dim">
              <span>{badge}</span>
              {liveRun.pid && badge !== `PID ${liveRun.pid}` && <span>· PID {liveRun.pid}</span>}
            </div>
          )}
        </div>
      </button>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        {liveRun ? (
          <>
            <button
              type="button"
              onClick={() => {
                openConsoleForRun(liveRun.runId)
                onClosePopover()
              }}
              aria-label={`Open terminal output for ${cfg.name}`}
              title="Open Launch Console"
              className={`${ICON_BTN_CLASS} text-theme-accent`}
            >
              <Terminal className="w-3.5 h-3.5" />
            </button>
            {browserUrl && (
              <Tooltip content={`Open ${browserUrl} in browser`} placement="top">
                <button
                  type="button"
                  onClick={() => void openExternalUrl(browserUrl, getRegisteredLaunchApi())}
                  aria-label={`Open ${browserUrl} in browser`}
                  className={`${ICON_BTN_CLASS} text-theme-accent`}
                >
                  <Globe className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            )}
            {liveRun.mode === 'debug' && (liveRun.attach?.attachJson || liveRun.attach?.wsUrl) && (
              <button
                type="button"
                onClick={() => onCopyAttach(liveRun)}
                aria-label={`Copy debug attach config for ${cfg.name}`}
                title={`Copy ${editorLabel} attach config`}
                className={ICON_BTN_CLASS}
              >
                {copiedRunId === liveRun.runId ? (
                  <Check className="w-3.5 h-3.5 text-theme-success" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            )}
            {liveRun.mode === 'debug' && (
              <button
                type="button"
                onClick={() => {
                  void getRegisteredLaunchApi()?.openInEditor(cfg.workspaceFolder, preferredEditor)
                }}
                aria-label={`Open ${cfg.name} in ${editorLabel}`}
                title={`Open folder in ${editorLabel}`}
                className={ICON_BTN_CLASS}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void restartRun(liveRun.runId)}
              aria-label={`Restart ${cfg.name}`}
              title="Restart"
              className={ICON_BTN_CLASS}
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void stopRuns([liveRun.runId])}
              aria-label={`Stop ${cfg.name}`}
              title="Stop"
              className={`${ICON_BTN_CLASS} hover:text-theme-error`}
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <>
            {latestRun && (
              <button
                type="button"
                onClick={() => {
                  openConsoleForRun(latestRun.runId)
                  onClosePopover()
                }}
                aria-label={`Open terminal output for ${cfg.name}`}
                title="View previous output"
                className={ICON_BTN_CLASS}
              >
                <Terminal className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void startConfigs(rootDir, [cfg.id], 'run')}
              aria-label={`Run ${cfg.name} without debugging`}
              title="Start Without Debugging"
              className={`${ICON_BTN_CLASS} hover:text-theme-success`}
            >
              <Play className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void startConfigs(rootDir, [cfg.id], 'debug')}
              aria-label={`Debug ${cfg.name}`}
              title={`Start in Debug Mode (${editorLabel} / netcoredbg / inspector)`}
              className={`${ICON_BTN_CLASS} hover:text-theme-warning`}
            >
              <Bug className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
