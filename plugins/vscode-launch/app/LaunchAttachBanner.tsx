import { useCallback, useState } from 'react'
import { Bug, Check, Copy, ExternalLink } from 'lucide-react'

import type { EditorKind, LaunchRunSummary } from '../src/types'

import { describeAttachEndpoint } from './attachFormat'
import type { VsCodeLaunchAPI } from './vscodeLaunchAPI'

export interface LaunchAttachBannerProps {
  run: LaunchRunSummary
  preferredEditor?: EditorKind
  api: VsCodeLaunchAPI
  writeClipboard: (text: string) => Promise<void>
}

export function LaunchAttachBanner({
  run,
  preferredEditor,
  api,
  writeClipboard,
}: LaunchAttachBannerProps) {
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null)
  const [editorMessage, setEditorMessage] = useState<string | null>(null)

  const attach = run.attach
  const attachCopyValue = attach?.attachJson ?? attach?.wsUrl
  const editorLabel = preferredEditor === 'codium' ? 'VSCodium' : 'VS Code'

  const handleCopyAttach = useCallback(async () => {
    if (!attachCopyValue) return
    await writeClipboard(attachCopyValue)
    setCopiedRunId(run.runId)
    setTimeout(() => {
      setCopiedRunId((prev) => (prev === run.runId ? null : prev))
    }, 1_800)
  }, [attachCopyValue, run.runId, writeClipboard])

  const handleOpenEditor = useCallback(async () => {
    const result = await api.openInEditor(run.workspaceFolder, preferredEditor)
    setEditorMessage(result.ok ? null : (result.message ?? 'Could not launch editor'))
  }, [api, preferredEditor, run.workspaceFolder])

  if (!attach) return null

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1 bg-theme-warning/10 border-b border-theme-border text-xs shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Bug className="w-3.5 h-3.5 text-theme-warning shrink-0" />
        <span className="font-mono text-theme-warning truncate tabular-nums">
          {describeAttachEndpoint(attach)}
        </span>
        {run.listeningUrls[0] && (
          <span className="text-theme-dim font-mono truncate hidden md:inline tabular-nums">
            • {run.listeningUrls[0]}
          </span>
        )}
        {editorMessage && <span className="text-theme-error truncate">{editorMessage}</span>}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {attachCopyValue && (
          <button
            type="button"
            aria-label="Copy attach configuration JSON"
            onClick={() => void handleCopyAttach()}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-theme-bg border border-theme-border text-[11px] font-medium text-theme-fg hover:bg-theme-hover transition-colors"
          >
            {copiedRunId === run.runId ? (
              <>
                <Check className="w-3 h-3 text-theme-success" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy Attach JSON</span>
              </>
            )}
          </button>
        )}

        {preferredEditor && (
          <button
            type="button"
            aria-label={`Open folder in ${editorLabel}`}
            onClick={() => void handleOpenEditor()}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-theme-bg border border-theme-border text-[11px] font-medium text-theme-fg hover:bg-theme-hover transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            <span>Open in {editorLabel}</span>
          </button>
        )}
      </div>
    </div>
  )
}
