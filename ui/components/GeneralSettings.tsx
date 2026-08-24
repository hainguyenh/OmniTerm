import React, { useEffect, useRef, useState } from 'react'
import { Download, FileText, Info, Lock, Plus, Upload, X } from 'lucide-react'
import type { Workspace } from '@omniterm/contract'
import { pickShell, type ShellOption } from '../shellOptions'
import type { UseDialogReturn } from '../hooks/useDialog'
import {
  decodeWorkspaceSelection,
  defaultWorkspaceToSelection,
  encodeWorkspaceSelection,
  type DefaultWorkspaceSetting,
} from '../utils/workspaceSelection'
import { Tooltip } from './Tooltip'

/**
 * The "General" block of the settings panel: the default terminal, and the size cap the built-in file
 * viewer/editor works to.
 *
 * Extracted from MainLayout to keep responsibilities and file size bounded. Like UpdateSettings, it owns no state,
 * takes the settings object and its setter, and writes a *partial* patch through
 * `omnitermAPI.settings.save` — the backend merges, so a patch must never be the whole object rebuilt
 * from stale props.
 */

/** Bounds offered in the UI. The backend clamps independently (safepath.rs), which is the enforcement. */
const MIN_OPEN_FILE_MB = 1
const MAX_OPEN_FILE_MB = 25

/**
 * Select-value encoding for the default-workspace setting: `unset` (follow last-used), `home`,
 * or `sel:<encoded workspace[::folder] selection>`. Kept as plain strings so the native select
 * stays a controlled input with no extra state.
 */
const defaultWorkspaceOptionValue = (setting: DefaultWorkspaceSetting | undefined): string => {
  if (!setting) return 'unset'
  if (setting.mode === 'home') return 'home'
  const selection = defaultWorkspaceToSelection(setting)
  return selection ? `sel:${selection}` : 'unset'
}

const parseDefaultWorkspaceOption = (value: string): DefaultWorkspaceSetting | undefined => {
  if (value === 'unset') return undefined
  if (value === 'home') return { mode: 'home' }
  const decoded = decodeWorkspaceSelection(value.slice(4))
  return decoded?.folderId
    ? { mode: 'folder', workspaceId: decoded.workspaceId, folderId: decoded.folderId }
    : { mode: 'workspace', workspaceId: decoded?.workspaceId ?? '' }
}

/**
 * Common text extensions offered as one-click toggles in "Excluded file types" — everything else is
 * reachable through the custom-extension input beside them. Curated rather than derived from a scan
 * (unlike the workspace filter's `discoverKinds`): this list is global, not tied to one workspace's
 * contents, so it has to name candidates up front instead of discovering them.
 */
const COMMON_VIEWABLE_EXTS = ['txt', 'md', 'log', 'json', 'yaml', 'yml', 'xml', 'csv', 'ini', 'env']

interface GeneralSettingsProps {
  /** The full settings object, as loaded from the backend. */
  appSettings: any
  setAppSettings: (settings: any) => void
  shellOptions: ShellOption[]
  /** Workspace catalog feeding the "default workspace for new terminals" select. */
  workspaces?: Workspace[]
  /** Closes the settings panel — the log button opens an OS folder behind it. */
  onCloseSettings: () => void
  /** Shared notifier (useDialog) for backup success and failure messages. */
  showAlert?: UseDialogReturn['showAlert']
}

const LABEL_CLS = 'text-[10px] text-theme-fg uppercase font-bold tracking-widest ml-0.5'
const FIELD_CLS =
  'bg-theme-bg border border-theme-border rounded-lg text-xs text-white focus:outline-none focus:border-theme-accent transition-colors'
const backupButtonClass =
  'flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-theme-fg hover:text-theme-accent bg-theme-bg border border-theme-border rounded-lg transition-colors'

/** Renderer-owned persistence-policy overrides ride inside the envelope's `sections`. */
const POLICIES_SECTION = 'persistencePolicies'
const POLICIES_STORAGE_KEY = 'omniterm:terminal-persistence-policies'

const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  appSettings,
  setAppSettings,
  shellOptions,
  workspaces = [],
  onCloseSettings,
  showAlert,
}) => {
  const importInputRef = useRef<HTMLInputElement>(null)
  const [pendingImport, setPendingImport] = useState<SettingsTransferEnvelope | null>(null)
  /** Apply a patch locally and persist just that patch. */
  const patch = (fields: Record<string, unknown>) => {
    setAppSettings({ ...appSettings, ...fields })
    window.omnitermAPI.settings.save(fields)
  }

  // The fixed half of the deny-list (safepath::VIEW_DENY_EXTS): fetched once, shown locked, so this
  // panel never claims the user can unhide something the viewer refuses outright.
  const [systemExcluded, setSystemExcluded] = useState<string[]>([])
  useEffect(() => { void window.omnitermAPI.settings.systemExcludedViewExts().then(setSystemExcluded) }, [])

  const excludedExts: string[] = appSettings.excludedViewableExts ?? []
  const [customExt, setCustomExt] = useState('')
  // The system list is long enough that spelling it out inline pushed everything below it down the
  // page; collapsed behind an info icon, opened on demand, instead.
  const [showSystemExcluded, setShowSystemExcluded] = useState(false)

  const toggleExcludedExt = (ext: string) => patch({
    excludedViewableExts: excludedExts.includes(ext)
      ? excludedExts.filter((e) => e !== ext)
      : [...excludedExts, ext],
  })

  const addExcludedExt = (raw: string) => {
    const ext = raw.trim().replace(/^\./, '').toLowerCase()
    if (!ext || systemExcluded.includes(ext) || excludedExts.includes(ext)) { setCustomExt(''); return }
    patch({ excludedViewableExts: [...excludedExts, ext] })
    setCustomExt('')
  }

  const notify = async (message: string, options?: { title?: string; tone?: 'error' }) => {
    if (showAlert) await showAlert(message, options)
  }

  /** Backend builds the envelope; the renderer-owned policy overrides ride along as a section. */
  const handleExport = async () => {
    try {
      const envelope = await window.omnitermAPI.settings.exportAll()
      let policies: Record<string, unknown> = {}
      try { policies = JSON.parse(localStorage.getItem(POLICIES_STORAGE_KEY) ?? '{}') } catch { /* storage optional */ }
      const withPolicies = { ...envelope, sections: { ...envelope.sections, [POLICIES_SECTION]: policies } }
      const blob = new Blob([JSON.stringify(withPolicies, null, 2)], { type: 'application/json' })
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
   * Validate client-side, then hand the envelope to the backend once the user picks a strategy
   * (rendered below when `pendingImport` is set). The backend rejects unknown sections and wrong
   * versions; this pre-parse only catches obvious non-JSON files before any store is touched.
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
      // Persistence policies are renderer-owned: lift them out before the backend sees an
      // unknown section, then apply them after the stores land.
      const sections = { ...pendingImport.sections } as Record<string, unknown>
      const policies = sections[POLICIES_SECTION]
      delete sections[POLICIES_SECTION]
      const report = await window.omnitermAPI.settings.importAll(
        { ...pendingImport, sections: sections as SettingsTransferEnvelope['sections'] },
        strategy,
      )
      if (policies && typeof policies === 'object') {
        localStorage.setItem(POLICIES_STORAGE_KEY, JSON.stringify(policies))
      }
      const counts = Object.entries(report.imported).map(([k, n]) => `${k}: ${n}`).join(', ') || 'nothing'
      await notify(`Settings imported (${strategy}) — ${counts}.`)
    } catch (error) {
      await notify(`Import failed: ${error instanceof Error ? error.message : String(error)}`, { tone: 'error' })
    } finally {
      setPendingImport(null)
    }
  }

  // Suggestions offered while typing (native <datalist>) — only extensions not already excluded one
  // way or the other, so the dropdown never suggests a no-op.
  const suggestions = COMMON_VIEWABLE_EXTS.filter((e) => !excludedExts.includes(e) && !systemExcluded.includes(e))

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold text-theme-fg uppercase tracking-wider">General Preferences</h3>
          <p className="text-[11px] text-theme-dim leading-relaxed mt-0.5">
            Default shell, file viewing limits, and extension filters.
          </p>
        </div>
        {/* Development only. A release or portable build writes no log (see
            src-tauri/src/app_utils.rs), so this would open an empty folder at best. */}
        {import.meta.env.DEV && (
          <Tooltip content="Open application log directory" placement="bottom">
            <button
              type="button"
              onClick={() => { onCloseSettings(); window.omnitermAPI.app.revealLog() }}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-theme-fg hover:text-theme-warning bg-theme-bg border border-theme-border rounded-lg transition-colors"
            >
              <FileText className="w-3 h-3 text-theme-warning" />
              Open log
            </button>
          </Tooltip>
        )}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-theme-border pt-3">
        <label htmlFor="default-shell" className={LABEL_CLS}>Default Terminal</label>
        <div className="relative">
          <select
            id="default-shell"
            value={pickShell(shellOptions, appSettings.defaultShell)}
            onChange={(e) => patch({ defaultShell: e.target.value })}
            className={`w-full py-2 pl-3 pr-8 appearance-none cursor-pointer ${FIELD_CLS}`}
          >
            {shellOptions.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-theme-dim">
            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
          </div>
        </div>
      </div>

      {/* Where a new terminal lands when its launch site does not name a workspace. "Last used"
          leaves the setting unset so the existing fallback chain keeps working. */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="default-workspace" className={LABEL_CLS}>Default workspace for new terminals</label>
        <div className="relative">
          <select
            id="default-workspace"
            value={defaultWorkspaceOptionValue(appSettings.defaultWorkspace)}
            onChange={(e) => patch({ defaultWorkspace: parseDefaultWorkspaceOption(e.target.value) })}
            className={`w-full py-2 pl-3 pr-8 appearance-none cursor-pointer ${FIELD_CLS}`}
          >
            <option value="unset">Last used</option>
            <option value="home">System home</option>
            {workspaces.map(workspace => (
              workspace.folders?.length
                ? (
                  <optgroup key={workspace.id} label={workspace.name}>
                    <option value={`sel:${encodeWorkspaceSelection(workspace.id)}`}>{workspace.name} (root)</option>
                    {workspace.folders.map(folder => (
                      <option key={folder.id} value={`sel:${encodeWorkspaceSelection(workspace.id, folder.id)}`}>
                        {workspace.name} / {folder.name}
                      </option>
                    ))}
                  </optgroup>
                )
                : (
                  <option key={workspace.id} value={`sel:${encodeWorkspaceSelection(workspace.id)}`}>
                    {workspace.name}
                  </option>
                )
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-theme-dim">
            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
          </div>
        </div>
      </div>

      {/* Viewer size cap. 1 MB covers every script and config file in a normal workspace; this exists
          for the person who wants to read a 3 MB log without leaving the app. */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="max-open-file-mb" className={LABEL_CLS}>Max file size to open</label>
        <div className="flex items-center gap-2">
          <input
            id="max-open-file-mb"
            type="number"
            min={MIN_OPEN_FILE_MB}
            max={MAX_OPEN_FILE_MB}
            step={1}
            value={appSettings.maxOpenFileMb ?? MIN_OPEN_FILE_MB}
            onChange={(e) => {
              // A cleared or non-numeric input must not persist NaN into settings.json — that reads
              // back as `null` and would look like "no limit" to a future caller.
              const parsed = Number.parseInt(e.target.value, 10)
              patch({
                maxOpenFileMb: Number.isFinite(parsed)
                  ? Math.min(MAX_OPEN_FILE_MB, Math.max(MIN_OPEN_FILE_MB, parsed))
                  : MIN_OPEN_FILE_MB,
              })
            }}
            className={`w-20 py-2 px-3 ${FIELD_CLS}`}
          />
          <span className="text-[11px] text-theme-dim">MB — applies to the file viewer and editor</span>
        </div>
      </div>

      {/* Excluded file types: the fixed, non-editable half (system) plus the user's own additions.
          Widening the fixed list is impossible by construction — it is only ever shown, never offered
          as something to toggle, and the input silently ignores an extension already on it. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <label className={LABEL_CLS}>Excluded file types</label>
          {systemExcluded.length > 0 && (
            <div className="relative">
              <Tooltip content="Show system-locked excluded file types" placement="bottom">
                <button
                  type="button"
                  onClick={() => setShowSystemExcluded((v) => !v)}
                  className="p-0.5 rounded text-theme-dim hover:text-theme-accent"
                  aria-label="Show system-locked excluded file types"
                >
                  <Info className="w-3 h-3" />
                </button>
              </Tooltip>
              {showSystemExcluded && (
                <>
                  {/* Click-outside catcher — a plain overlay, not a focus trap, since this is just a list. */}
                  <div className="fixed inset-0 z-10" onClick={() => setShowSystemExcluded(false)} />
                  <div className="absolute left-0 top-full mt-1 z-20 w-56 max-h-40 overflow-y-auto p-2 rounded border border-theme-border bg-theme-bg shadow-lg">
                    <p className="flex items-center gap-1 text-[10px] text-theme-dim mb-1.5">
                      <Lock className="w-3 h-3" /> Always excluded — cannot be changed
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {systemExcluded.map((ext) => (
                        <span
                          key={ext}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-theme-border text-[11px] text-theme-dim"
                        >
                          .{ext}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <p className="text-[11px] text-theme-dim -mt-0.5">
          Hide extensions from the built-in file viewer, on top of the types the app always excludes.
        </p>

        <div className="flex items-center gap-1.5 mt-1">
          <input
            type="text"
            list="excluded-ext-suggestions"
            value={customExt}
            onChange={(e) => setCustomExt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExcludedExt(customExt) } }}
            placeholder="Type an extension (e.g. rst, log)"
            className={`flex-1 py-1.5 px-2.5 ${FIELD_CLS}`}
          />
          <datalist id="excluded-ext-suggestions">
            {suggestions.map((ext) => <option key={ext} value={ext} />)}
          </datalist>
          <Tooltip content="Add extension to exclude list" shortcut="Enter" placement="bottom">
            <button
              type="button"
              onClick={() => addExcludedExt(customExt)}
              disabled={!customExt.trim()}
              className="flex-shrink-0 p-1.5 rounded-lg border border-theme-border text-theme-dim hover:text-theme-accent hover:border-theme-accent disabled:opacity-40 disabled:pointer-events-none"
              aria-label="Add extension to exclude list"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>

        {/* Currently-excluded extensions — common or custom, all in one compact row instead of a
            second grid, so this section's height no longer depends on how many are checked. */}
        {excludedExts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {excludedExts.map((ext) => (
              <span
                key={ext}
                className="flex items-center gap-1 px-2 py-1 rounded-lg border border-theme-border text-[11px] text-theme-fg bg-theme-bg"
              >
                .{ext}
                <Tooltip content={`Stop excluding .${ext}`} placement="top">
                  <button
                    type="button"
                    onClick={() => toggleExcludedExt(ext)}
                    className="text-theme-dim hover:text-red-400 p-0.5"
                    aria-label={`Stop excluding .${ext}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Tooltip>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Settings backup. The envelope is produced and applied by the backend; this UI only
          stitches the renderer-owned persistence-policy overrides around those two calls.
          Secrets cannot be in the file: the connection store holds none (connections.rs). */}
      <div className="flex flex-col gap-1.5 border-t border-theme-border pt-3">
        <span className={LABEL_CLS}>Backup &amp; restore</span>
        <p className="text-[11px] text-theme-dim -mt-0.5">
          Export or import app settings, connections, themes, workspaces, and persistence policies
          as one JSON file. Connection credentials are never stored, so none are ever exported.
        </p>
        <div className="flex items-center gap-2">
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
            onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; void acceptImportFile(file) }}
          />
        </div>
        {pendingImport && (
          <div className="flex flex-wrap items-center gap-2 mt-1 p-2 rounded-lg border border-theme-border bg-theme-bg">
            {/* Three-way import choice: the shared dialog is boolean-only, so an inline row is
                the honest shape for merge / replace / cancel. Replace is listed last and styled
                destructive because it discards everything absent from the backup. */}
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
    </div>
  )
}

export default GeneralSettings
