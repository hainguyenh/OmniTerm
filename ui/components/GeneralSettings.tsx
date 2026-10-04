import React, { useEffect, useState } from 'react'
import { Bot, Database, FileText, GitBranch, Info, Lock, Plus, Sliders, SquareTerminal, X } from 'lucide-react'
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
import ToggleRow from './ToggleRow'
import TerminalToolbarSettings from './TerminalToolbarSettings'
import AttachmentsSettings from './AttachmentsSettings'
import SettingsBackupSection from './SettingsBackupSection'
import type { TerminalToolbarActions } from '../terminalToolbar'

const MIN_OPEN_FILE_MB = 1
const MAX_OPEN_FILE_MB = 25

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

const COMMON_VIEWABLE_EXTS = ['txt', 'md', 'log', 'json', 'yaml', 'yml', 'xml', 'csv', 'ini', 'env']

interface GeneralSettingsProps {
  appSettings: any
  setAppSettings: (settings: any) => void
  shellOptions: ShellOption[]
  workspaces?: Workspace[]
  onCloseSettings: () => void
  showAlert?: UseDialogReturn['showAlert']
}

interface ToolbarAppearanceRecord {
  toolbarActions?: TerminalToolbarActions
  [key: string]: unknown
}

const LABEL_CLS = 'text-[10px] text-theme-fg uppercase font-bold tracking-widest ml-0.5'
const FIELD_CLS =
  'bg-theme-bg border border-theme-border rounded-lg text-xs text-white focus:outline-none focus:border-theme-accent transition-colors'
const CARD_CLS = 'rounded-xl border border-theme-border/60 bg-theme-bg/30 p-4 flex flex-col gap-3.5 shadow-sm'
const SECTION_TITLE_CLS = 'flex items-center gap-2 text-xs font-bold text-theme-fg tracking-wide uppercase'

const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  appSettings,
  setAppSettings,
  shellOptions,
  workspaces = [],
  onCloseSettings,
  showAlert,
}) => {
  const patch = (fields: Record<string, unknown>) => {
    setAppSettings({ ...appSettings, ...fields })
    window.omnitermAPI.settings.save(fields)
  }

  const [systemExcluded, setSystemExcluded] = useState<string[]>([])
  useEffect(() => { void window.omnitermAPI.settings.systemExcludedViewExts().then(setSystemExcluded) }, [])

  const excludedExts: string[] = appSettings.excludedViewableExts ?? []
  const [customExt, setCustomExt] = useState('')
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

  const suggestions = COMMON_VIEWABLE_EXTS.filter((e) => !excludedExts.includes(e) && !systemExcluded.includes(e))

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold text-theme-fg uppercase tracking-wider">General Preferences</h3>
          <p className="text-[11px] text-theme-dim leading-relaxed mt-0.5">
            Configure terminal defaults, agent behavior, file attachments, and backups.
          </p>
        </div>
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

      {/* ── Section 1: Terminal & Shell ── */}
      <section className={CARD_CLS} aria-label="Terminal & Shell Preferences">
        <div className={SECTION_TITLE_CLS}>
          <SquareTerminal className="w-3.5 h-3.5 text-theme-accent" />
          <span>Terminal &amp; Shell</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
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
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-theme-border/40">
          <ToggleRow
            label="Command completion"
            description="Show the shell's inline suggestions (PowerShell). Turn off if typing with a Windows IME such as Vietnamese Telex repeats text. Applies to new panes."
            checked={appSettings.commandCompletion ?? true}
            onChange={() => patch({ commandCompletion: !(appSettings.commandCompletion ?? true) })}
            ariaLabel="Command completion"
          />

          <ToggleRow
            label="Don't ask before closing connected terminals"
            description="Close connected terminal sessions without showing the Close Terminal dialog."
            checked={appSettings.skipTerminalCloseConfirm ?? false}
            onChange={() => patch({ skipTerminalCloseConfirm: !(appSettings.skipTerminalCloseConfirm ?? false) })}
            ariaLabel="Skip terminal close confirmation"
          />
        </div>
      </section>

      {/* ── Section 2: AI Agents ── */}
      <section className={CARD_CLS} aria-label="AI Agents Preferences">
        <div className={SECTION_TITLE_CLS}>
          <Bot className="w-3.5 h-3.5 text-theme-accent" />
          <span>AI Agents</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="agent-renew-strategy" className={LABEL_CLS}>AI Agent Renew Strategy</label>
          <p className="text-[11px] text-theme-dim -mt-0.5">
            Choose action when clicking the refresh button on an active agent session.
          </p>
          <div className="relative">
            <select
              id="agent-renew-strategy"
              value={appSettings.agentRenewStrategy ?? 'reopen'}
              onChange={(e) => patch({ agentRenewStrategy: e.target.value as 'reopen' | 'new-command' })}
              className={`w-full py-2 pl-3 pr-8 appearance-none cursor-pointer ${FIELD_CLS}`}
            >
              <option value="reopen">Restart session with profile in current folder (default)</option>
              <option value="new-command">Start a new conversation in the agent (/clear, /new)</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-theme-dim">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 3: Terminal Header & Footer ── */}
      <section className={CARD_CLS} aria-label="Terminal Toolbar Actions">
        <div className={SECTION_TITLE_CLS}>
          <Sliders className="w-3.5 h-3.5 text-theme-accent" />
          <span>Terminal Actions &amp; Toolbar</span>
        </div>
        <TerminalToolbarSettings
          value={appSettings.toolbarActions}
          onChange={(toolbarActions: TerminalToolbarActions) => {
            const perConn = Object.fromEntries(
              Object.entries((appSettings.perConn ?? {}) as Record<string, ToolbarAppearanceRecord>).map(([id, appearance]) => {
                const { toolbarActions: _override, ...rest } = appearance
                return [id, rest]
              }),
            )
            patch({ toolbarActions, perConn })
          }}
        />
      </section>

      {/* ── Section 4: Git Integration ── */}
      <section className={CARD_CLS} aria-label="Git Integration Preferences">
        <div className={SECTION_TITLE_CLS}>
          <GitBranch className="w-3.5 h-3.5 text-theme-accent" />
          <span>Git Integration</span>
        </div>
        <ToggleRow
          label="Enable Git utilities"
          description="Show Git workspace in Activity Bar and repository branch indicator in the status bar."
          checked={appSettings.gitUtilEnabled ?? true}
          onChange={() => patch({ gitUtilEnabled: !(appSettings.gitUtilEnabled ?? true) })}
          ariaLabel="Enable Git utilities"
        />
        <ToggleRow
          label="Show Git Graph tab"
          description="Display the Source Git Graph navigation tab in the Git workspace view."
          checked={appSettings.gitGraphEnabled ?? true}
          onChange={() => patch({ gitGraphEnabled: !(appSettings.gitGraphEnabled ?? true) })}
          ariaLabel="Show Git Graph tab"
        />
      </section>

      {/* ── Section 5: Files & Attachments ── */}
      <section className={CARD_CLS} aria-label="Files & Attachments Preferences">
        <div className={SECTION_TITLE_CLS}>
          <FileText className="w-3.5 h-3.5 text-theme-accent" />
          <span>Files &amp; Attachments</span>
        </div>

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

        <div className="flex flex-col gap-1.5 pt-2 border-t border-theme-border/40">
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

        <div className="pt-2 border-t border-theme-border/40">
          <AttachmentsSettings largePaste={appSettings.largePaste} onLargePasteChange={(largePaste) => patch({ largePaste })} />
        </div>
      </section>

      {/* ── Section 5: Data & Backup ── */}
      <section className={CARD_CLS} aria-label="Backup & Restore">
        <div className={SECTION_TITLE_CLS}>
          <Database className="w-3.5 h-3.5 text-theme-accent" />
          <span>Data &amp; Backup</span>
        </div>
        <SettingsBackupSection showAlert={showAlert} />
      </section>
    </div>
  )
}

export default GeneralSettings
