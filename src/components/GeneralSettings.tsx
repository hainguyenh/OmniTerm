import React, { useEffect, useState } from 'react'
import { FileText, Info, Lock, Plus, X } from 'lucide-react'
import { pickShell, type ShellOption } from '../shellOptions'

/**
 * The "General" block of the settings panel: the default terminal, and the size cap the built-in file
 * viewer/editor works to.
 *
 * Extracted from MainLayout, which is over the per-file line limit and ratcheting down (see
 * src/__tests__/code-write.lines.test.ts). Follows the same shape as UpdateSettings: it owns no state,
 * takes the settings object and its setter, and writes a *partial* patch through
 * `omnitermAPI.settings.save` — the backend merges, so a patch must never be the whole object rebuilt
 * from stale props.
 */

/** Bounds offered in the UI. The backend clamps independently (safepath.rs), which is the enforcement. */
const MIN_OPEN_FILE_MB = 1
const MAX_OPEN_FILE_MB = 25

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
  /** Closes the settings panel — the log button opens an OS folder behind it. */
  onCloseSettings: () => void
}

const LABEL_CLS = 'text-[10px] text-theme-fg uppercase font-bold tracking-widest ml-0.5'
const FIELD_CLS =
  'bg-theme-bg border border-theme-border rounded-lg text-xs text-white focus:outline-none focus:border-theme-accent transition-colors'

const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  appSettings,
  setAppSettings,
  shellOptions,
  onCloseSettings,
}) => {
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

  // Suggestions offered while typing (native <datalist>) — only extensions not already excluded one
  // way or the other, so the dropdown never suggests a no-op.
  const suggestions = COMMON_VIEWABLE_EXTS.filter((e) => !excludedExts.includes(e) && !systemExcluded.includes(e))

  return (
    <div className="px-4 py-2.5 border-t border-theme-border">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase font-bold tracking-widest text-theme-dim">General</p>
        {/* Development only. A release or portable build writes no log (see
            src-tauri/src/app_utils.rs), so this would open an empty folder at best. */}
        {import.meta.env.DEV && (
          <button type="button"
            onClick={() => { onCloseSettings(); window.omnitermAPI.app.revealLog() }}
            className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-theme-fg hover:text-theme-warning bg-theme-bg border border-theme-border rounded transition-colors"
            title="Open application log">
            <FileText className="w-3 h-3 text-theme-warning" />Open log
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
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

      {/* Viewer size cap. 1 MB covers every script and config file in a normal workspace; this exists
          for the person who wants to read a 3 MB log without leaving the app. */}
      <div className="flex flex-col gap-1.5 mt-3">
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
      <div className="flex flex-col gap-1.5 mt-3">
        <div className="flex items-center gap-1.5">
          <label className={LABEL_CLS}>Excluded file types</label>
          {systemExcluded.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSystemExcluded((v) => !v)}
                className="p-0.5 rounded text-theme-dim hover:text-theme-accent"
                title="Show the file types the app always excludes"
              >
                <Info className="w-3 h-3" />
              </button>
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
          <button
            type="button"
            onClick={() => addExcludedExt(customExt)}
            disabled={!customExt.trim()}
            className="flex-shrink-0 p-1.5 rounded border border-theme-border text-theme-dim hover:text-theme-accent hover:border-theme-accent disabled:opacity-40 disabled:pointer-events-none"
            title="Add extension"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Currently-excluded extensions — common or custom, all in one compact row instead of a
            second grid, so this section's height no longer depends on how many are checked. */}
        {excludedExts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {excludedExts.map((ext) => (
              <span
                key={ext}
                className="flex items-center gap-1 px-2 py-1 rounded border border-theme-border text-[11px] text-theme-fg"
              >
                .{ext}
                <button
                  type="button"
                  onClick={() => toggleExcludedExt(ext)}
                  className="text-theme-dim hover:text-red-400"
                  title={`Stop excluding .${ext}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default GeneralSettings
