import React, { useState, useEffect } from 'react'
import { X, Save, Terminal, Monitor, Plus, HardDrive, FolderOpen } from 'lucide-react'
import { Connection, Folder, LocalShell } from './MainLayout'
import { useEscToClose } from '../hooks/useEscToClose'
import ConfirmDialog from './ConfirmDialog'
import { pickShell, shellLabel } from '../shellOptions'
import { useShellOptions } from '../hooks/useShellOptions'
import { LocalShellSelect } from './LocalShellSelect'
import ConnectionAdvanced from './ConnectionAdvanced'
import ToggleRow from './ToggleRow'
interface ConnectionFormProps {
  folders: Folder[]
  capabilities?: ConnectionProviderCapabilities | null
  scopeLabel?: string
  /**
   * What the Parent Folder select calls "no folder". A workspace names its own root folder, so the
   * user picks between `MyProject` and a path inside it rather than an abstract "Root".
   */
  rootLabel?: string
  /** When present, form operates in edit mode (prefill + update). */
  initial?: Connection
  /** Pre-select a parent folder (e.g. when creating inside a folder). */
  defaultParentId?: string
  onClose: () => void
  /** Called for both create and update; consumer differentiates by whether initial was set. */
  onSave: (conn: Connection) => void | Promise<void>
}
/**
 * Flatten the folder tree into select options, each labelled with its full path.
 *
 * Depth-first so the list still reads top-down, but the label is the breadcrumb of ancestor names
 * (`infra / deploy / prod`) rather than an indent: `<option>` collapses leading whitespace, so the
 * old two-spaces-per-level version rendered as a flat list of bare names with no way to tell two
 * same-named folders apart.
 *
 * The path is walked through `parentId` rather than read off `folder.id` — that id happens to be the
 * relative path for workspace folders, but the `Folder` contract does not promise it in general.
 */
function buildFolderOptions(
  folders: Folder[],
  parentId: string | undefined,
  trail: string[] = []
): { id: string; label: string }[] {
  const children = folders.filter(f => f.parentId === parentId)
  const result: { id: string; label: string }[] = []
  for (const f of children) {
    const path = [...trail, f.name]
    result.push({ id: f.id, label: path.join(' / ') })
    result.push(...buildFolderOptions(folders, f.id, path))
  }
  return result
}
const ConnectionForm: React.FC<ConnectionFormProps> = ({
  folders,
  capabilities,
  scopeLabel = 'Personal',
  rootLabel = 'Root',
  initial,
  defaultParentId,
  onClose,
  onSave,
}) => {
  const isEdit = Boolean(initial)
  const isMac = window.omnitermAPI.app.platform === 'darwin'

  const [type, setType] = useState<'SSH' | 'RDP' | 'LOCAL'>(initial?.type ?? 'SSH')
  const [name, setName] = useState(initial?.name ?? '')
  const [host, setHost] = useState(initial?.host ?? '')
  const [port, setPort] = useState(initial?.port ?? '22')
  const [user, setUser] = useState(initial?.user ?? '')
  const [passwordHelpUrl, setPasswordHelpUrl] = useState(initial?.passwordHelpUrl ?? '')
  const [parentId, setParentId] = useState(initial?.parentId ?? defaultParentId ?? '')
  const [trustReset, setTrustReset] = useState(false)
  // RDP only: share local drives with the remote session (file transfer). Off by default.
  const [redirectDrives, setRedirectDrives] = useState(initial?.redirectDrives ?? false)
  // A saved connection may name a shell this machine does not have; the effect below degrades it to
  // one it does, once the probe settles.
  const shellOptions = useShellOptions()
  const [shell, setShell] = useState<LocalShell>((initial?.shell ?? 'default') as LocalShell)
  const [localArgs, setLocalArgs] = useState(initial?.localArgs ?? '')
  const [localCwd, setLocalCwd] = useState(initial?.localCwd ?? '')
  // LOCAL + shell 'cmd'/'powershell' only: an optional command/batch, captured inside the pane.
  const [localCommand, setLocalCommand] = useState(initial?.localCommand ?? '')
  const [localKeepOpen, setLocalKeepOpen] = useState(initial?.localKeepOpen ?? true)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)

  const handleResetTrust = async () => {
    await window.omnitermAPI.connect.rdpResetTrust(host, port)
    setTrustReset(true)
    setTimeout(() => setTrustReset(false), 2500)
  }

  // New LOCAL connection with no cwd yet — default to the home folder (never overwrites a set value).
  useEffect(() => {
    if (isEdit || type !== 'LOCAL' || localCwd) return
    window.omnitermAPI.files.getHomeDir().then(dir => { if (dir) setLocalCwd(dir) })
  }, [type])

  const handleBrowseCwd = async () => {
    const dir = await window.omnitermAPI.files.pickDirectory(localCwd || undefined)
    if (dir) setLocalCwd(dir)
  }

  useEffect(() => {
    if (shellOptions.length) setShell(prev => pickShell(shellOptions, prev) as LocalShell)
  }, [shellOptions])

  const folderOptions = buildFolderOptions(folders, undefined)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Every type-owned field is always emitted — `undefined` when it doesn't apply to the
    // current type — so handleUpdateConnection's merge ({...c, ...conn}) actively CLEARS
    // stale values from a previous type instead of an omitted key silently preserving them.
    const savedConn: Connection = {
      id: initial?.id ?? crypto.randomUUID(),
      type,
      name: name.trim() || (type === 'LOCAL' ? shellLabel(shellOptions, shell) : host),
      host,
      port,
      user,
      passwordHelpUrl: type !== 'LOCAL' && capabilities?.credentialPolicy === 'prompt-every-time' && passwordHelpUrl.trim()
        ? passwordHelpUrl.trim()
        : undefined,
      parentId: parentId || undefined,
      redirectDrives: type === 'RDP' && redirectDrives ? true : undefined,
      shell: type === 'LOCAL' ? shell : undefined,
      localArgs: type === 'LOCAL' && localArgs.trim() ? localArgs.trim() : undefined,
      localCwd: type === 'LOCAL' && localCwd.trim() ? localCwd.trim() : undefined,
      localCommand: type === 'LOCAL' && localCommand.trim() ? localCommand.trim() : undefined,
      localKeepOpen: type === 'LOCAL' ? localKeepOpen : undefined,
    }

    await onSave(savedConn)
    onClose()
  }

  const handleClose = () => {
    onClose()
  }

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose()
  }

  // Has the user changed anything from the initial/default values? Compared
  // against the same defaults used in the useState initializers so reverting an
  // edit clears the dirty state.
  const dirty =
    type !== (initial?.type ?? 'SSH') ||
    name !== (initial?.name ?? '') ||
    host !== (initial?.host ?? '') ||
    port !== (initial?.port ?? '22') ||
    user !== (initial?.user ?? '') ||
    passwordHelpUrl !== (initial?.passwordHelpUrl ?? '') ||
    parentId !== (initial?.parentId ?? defaultParentId ?? '') ||
    redirectDrives !== (initial?.redirectDrives ?? false) ||
    // Not `initial.shell`: settling the probe can legally move the selection off an unavailable saved
    // shell, and that is not the user editing the form.
    shell !== pickShell(shellOptions, initial?.shell) ||
    localArgs !== (initial?.localArgs ?? '') ||
    localCwd !== (initial?.localCwd ?? '') ||
    localCommand !== (initial?.localCommand ?? '') ||
    localKeepOpen !== (initial?.localKeepOpen ?? true)

  // Esc closes; if there are unsaved edits, confirm first. Suspended while the
  // confirmation itself is open. The X button / backdrop bypass this guard.
  useEscToClose(dirty, handleClose, () => setShowDiscardConfirm(true), !showDiscardConfirm)

  const inputClass =
    'w-full bg-theme-bg border border-theme-border rounded-xl py-1.5 px-3 text-white focus:outline-none focus:border-theme-accent transition-colors'
  const labelClass = 'text-[10px] text-theme-dim uppercase font-bold ml-1'

  // Open Advanced on mount when a saved connection already has something in there — a hidden
  // non-default value is worse than an extra click.
  const defaultPort = initial?.type === 'RDP' ? '3389' : initial?.type === 'LOCAL' ? '' : '22'
  const advancedPreset = Boolean(
    initial && (
      (initial.port ?? '') !== defaultPort ||
      initial.parentId ||
      initial.passwordHelpUrl ||
      initial.localArgs ||
      initial.redirectDrives
    ),
  )

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={handleBackdrop}
    >
      <div className="bg-theme-popup w-full max-w-[480px] rounded-2xl border border-theme-border shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-3.5 border-b border-theme-border">
          <h2 className="text-[var(--theme-fg)] font-bold flex items-center gap-2">
            <Plus className="w-5 h-5 text-theme-accent" />
            {isEdit ? 'Edit Connection' : 'New Connection'}
          </h2>
          <button
            onClick={handleClose}
            className="text-theme-dim hover:text-theme-error transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* The modal shell is overflow-hidden, so the form owns the scroll: expanding Advanced on a
            short window used to push the submit button out of reach. */}
        <form onSubmit={handleSubmit} className="p-4 space-y-2 max-h-[75vh] overflow-y-auto custom-scrollbar">
          {/* SSH / RDP / Local toggle */}
          <div className="flex items-center justify-between px-1">
            <span className={labelClass}>Scope</span>
            <span className="text-xs font-medium text-theme-fg">{scopeLabel}</span>
          </div>
          <div className="flex gap-2 p-1 bg-theme-bg rounded-xl border border-theme-border">
            <button
              type="button"
              onClick={() => { setType('SSH'); setPort('22') }}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg transition-all ${
                type === 'SSH'
                  ? 'bg-theme-accent text-theme-accent-fg font-semibold'
                  : 'text-theme-dim hover:text-theme-fg'
              }`}
            >
              <Terminal className="w-4 h-4" />
              SSH
            </button>
            <button
              type="button"
              onClick={() => { setType('RDP'); setPort('3389') }}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg transition-all ${
                type === 'RDP'
                  ? 'bg-theme-accent text-theme-accent-fg font-semibold'
                  : 'text-theme-dim hover:text-theme-fg'
              }`}
            >
              <Monitor className="w-4 h-4" />
              RDP
            </button>
            {!capabilities && <button
              type="button"
              onClick={() => { setType('LOCAL'); setPort('') }}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg transition-all ${
                type === 'LOCAL'
                  ? 'bg-theme-warning text-theme-accent-fg font-semibold'
                  : 'text-theme-dim hover:text-theme-fg'
              }`}
            >
              <HardDrive className="w-4 h-4" />
              Local
            </button>}
          </div>

          {/* Display Name + Host (Host hidden for LOCAL — no remote target) */}
          <div className={`grid ${type === 'LOCAL' ? 'grid-cols-1' : 'grid-cols-2'} gap-3`}>
            <div className="space-y-0.5">
              <label className={labelClass}>Display Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={type === 'LOCAL' ? shellLabel(shellOptions, shell) : 'My Server'}
                className={inputClass}
              />
            </div>
            {type !== 'LOCAL' && (
              <div className="space-y-0.5">
                <label className={labelClass}>Host / IP</label>
                <input
                  type="text"
                  required
                  value={host}
                  onChange={e => setHost(e.target.value)}
                  placeholder="192.168.1.1"
                  className={inputClass}
                />
              </div>
            )}
          </div>

          {/* Shell selector — LOCAL only. */}
          {type === 'LOCAL' && (
            <LocalShellSelect
              options={shellOptions}
              value={shell}
              onChange={id => setShell(id as LocalShell)}
              labelClass={labelClass}
              selectClass={`${inputClass} appearance-none`}
            />
          )}

          {/* Working dir — all LOCAL shells (Browse picks any folder). Extra args live in Advanced. */}
          {type === 'LOCAL' && (
            <div className="space-y-0.5">
              <label className={labelClass}>Working directory</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={localCwd}
                  onChange={e => setLocalCwd(e.target.value)}
                  placeholder={isMac ? '/Users/you' : 'C:\\Users\\you'}
                  className={`${inputClass} flex-1 min-w-0`}
                />
                <button
                  type="button"
                  onClick={handleBrowseCwd}
                  title="Browse for a folder"
                  className="shrink-0 px-2.5 rounded-xl border border-theme-border text-theme-fg hover:border-theme-accent hover:text-white transition-colors"
                >
                  <FolderOpen className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Optional command or batch, captured inside this app's terminal pane. */}
          {type === 'LOCAL' && (
            <div className="space-y-2">
              <div className="space-y-0.5">
                <label className={labelClass}>Command / Batch (optional)</label>
                <input
                  type="text"
                  value={localCommand}
                  onChange={e => setLocalCommand(e.target.value)}
                  placeholder={isMac ? './deploy.sh' : shell === 'powershell' ? '.\\deploy.ps1' : 'C:\\path\\to\\build.bat'}
                  className={inputClass}
                />
              </div>
              <ToggleRow
                label="Keep terminal open after it finishes"
                description="Off exits the pane as soon as the command completes."
                checked={localKeepOpen}
                onChange={() => setLocalKeepOpen(v => !v)}
                ariaLabel="Keep terminal open after the command finishes"
              />
            </div>
          )}

          {/* Username — hidden for LOCAL. Port lives in Advanced: the type toggle already sets it. */}
          {type !== 'LOCAL' && (
            <div className="space-y-0.5">
              <label className={labelClass}>Username</label>
              <input
                type="text"
                value={user}
                onChange={e => setUser(e.target.value)}
                placeholder="root"
                className={inputClass}
              />
            </div>
          )}


          <ConnectionAdvanced
            defaultOpen={advancedPreset}
            type={type}
            isEdit={isEdit}
            argsPlaceholder={isMac ? '--no-rcs' : shell === 'powershell' ? '-NoProfile' : shell === 'cmd' ? '/v:on' : '-d Ubuntu-22.04'}
            port={port}
            onPortChange={setPort}
            localArgs={localArgs}
            onLocalArgsChange={setLocalArgs}
            folderOptions={folderOptions}
            parentId={parentId}
            onParentIdChange={setParentId}
            rootLabel={rootLabel}
            showPasswordHelp={type !== 'LOCAL' && capabilities?.credentialPolicy === 'prompt-every-time'}
            passwordHelpUrl={passwordHelpUrl}
            onPasswordHelpUrlChange={setPasswordHelpUrl}
            redirectDrives={redirectDrives}
            onRedirectDrivesToggle={() => setRedirectDrives(v => !v)}
            trustReset={trustReset}
            onResetTrust={handleResetTrust}
            inputClass={inputClass}
            labelClass={labelClass}
          />

          {/* Submit */}
          <div className="pt-2">
            <button
              type="submit"
              className="w-full bg-theme-accent hover:bg-[#89ddff] text-theme-accent-fg font-bold py-2 rounded-xl flex items-center justify-center gap-2 transition-all transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <Save className="w-4 h-4" />
              {isEdit ? 'Update Connection' : 'Save Connection'}
            </button>
          </div>
        </form>
      </div>

      {showDiscardConfirm && (
        <ConfirmDialog
          title="Discard changes?"
          message="You have unsaved changes. Close without saving?"
          onConfirm={handleClose}
          onCancel={() => setShowDiscardConfirm(false)}
        />
      )}
    </div>
  )
}

export default ConnectionForm
