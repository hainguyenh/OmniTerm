import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import type { UseDialogReturn } from '../hooks/useDialog'

interface SettingsBackupSectionProps {
  showAlert?: UseDialogReturn['showAlert']
}

const LABEL_CLS = 'text-[10px] text-theme-fg uppercase font-bold tracking-widest ml-0.5'
const backupButtonClass =
  'flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-theme-fg hover:text-theme-accent bg-theme-bg border border-theme-border rounded-lg transition-colors'

export default function SettingsBackupSection({ showAlert }: SettingsBackupSectionProps) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const [pendingImport, setPendingImport] = useState<SettingsTransferEnvelope | null>(null)

  const notify = async (message: string, options?: { title?: string; tone?: 'error' }) => {
    if (showAlert) await showAlert(message, options)
  }

  /** Backend builds the complete settings envelope. */
  const handleExport = async () => {
    try {
      const envelope = await window.omnitermAPI.settings.exportAll()
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `omniterm-settings-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      await notify('Settings exported.')
    } catch (error) {
      await notify(`Export failed: ${error instanceof Error ? error.message : String(error)}`, { tone: 'error' })
    }
  }

  /**
   * Validate client-side, then hand the envelope to the backend once the user picks a strategy.
   */
  const acceptImportFile = async (file: File | undefined) => {
    if (!file) return
    try {
      setPendingImport(JSON.parse(await file.text()) as SettingsTransferEnvelope)
    } catch {
      await notify('Import failed: not a valid JSON settings backup.', { tone: 'error' })
    }
  }

  const runImport = async (strategy: 'merge' | 'replace') => {
    if (!pendingImport) return
    try {
      const report = await window.omnitermAPI.settings.importAll(pendingImport, strategy)
      const counts = Object.entries(report.imported).map(([k, n]) => `${k}: ${n}`).join(', ') || 'nothing'
      await notify(`Settings imported (${strategy}) — ${counts}.`)
    } catch (error) {
      await notify(`Export failed: ${error instanceof Error ? error.message : String(error)}`, { tone: 'error' })
    } finally {
      setPendingImport(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className={LABEL_CLS}>Backup &amp; restore</span>
      <p className="text-[11px] text-theme-dim -mt-1 leading-relaxed">
        Export or import app settings, connections, themes, and workspaces as one JSON file.
        Connection credentials are never stored, so none are ever exported.
      </p>
      <div className="flex items-center gap-2 mt-0.5">
        <button type="button" onClick={handleExport} className={backupButtonClass}>
          <Download className="w-3.5 h-3.5" /> Export settings
        </button>
        <button type="button" onClick={() => importInputRef.current?.click()} className={backupButtonClass}>
          <Upload className="w-3.5 h-3.5" /> Import settings
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            void acceptImportFile(file)
          }}
        />
      </div>
      {pendingImport && (
        <div className="flex flex-wrap items-center gap-2 mt-1 p-2 rounded-lg border border-theme-border bg-theme-bg">
          <span className="text-[11px] text-theme-dim flex-1 min-w-0 truncate">
            Import “{pendingImport.exportedAt || 'backup'}”?
          </span>
          <button type="button" onClick={() => void runImport('merge')} className={backupButtonClass}>Merge</button>
          <button
            type="button"
            onClick={() => void runImport('replace')}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-theme-error hover:text-theme-error bg-theme-bg border border-theme-error rounded-lg transition-colors"
          >
            Replace all
          </button>
          <button type="button" onClick={() => setPendingImport(null)} className={backupButtonClass}>Cancel</button>
        </div>
      )}
    </div>
  )
}
