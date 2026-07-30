import React, { useState } from 'react'
import { ChevronDown, ChevronRight, HardDrive, ShieldOff, SlidersHorizontal } from 'lucide-react'
import PasswordHelpField from './PasswordHelpField'
import ToggleRow from './ToggleRow'

/**
 * The collapsible "Advanced" block of the connection form.
 *
 * Everything a connection *needs* stays in the open above it; the dials that already have a sensible
 * answer live in here — the port the type toggle just set, the folder the user clicked in, the page
 * their password is kept on, RDP drive sharing — so the form reads as three or four fields.
 *
 * `defaultOpen` is set when a saved connection already uses one of them: a non-default value hidden
 * behind a closed section reads as "not set", which is worse than an extra click.
 */
interface ConnectionAdvancedProps {
  defaultOpen: boolean
  type: 'SSH' | 'RDP' | 'LOCAL'
  isEdit: boolean
  /** Placeholder wording for the LOCAL extra-arguments field. */
  argsPlaceholder: string
  port: string
  onPortChange: (value: string) => void
  localArgs: string
  onLocalArgsChange: (value: string) => void
  /** Indented folder options for the Parent Folder select (root is rendered separately). */
  folderOptions: { id: string; label: string }[]
  parentId: string
  onParentIdChange: (value: string) => void
  /** What the select calls "no folder" — the workspace's own name, not a generic "Root". */
  rootLabel: string
  /** Only the password-free provider offers a help link; the OS-vault one has its own controls. */
  showPasswordHelp: boolean
  passwordHelpUrl: string
  onPasswordHelpUrlChange: (value: string) => void
  redirectDrives: boolean
  onRedirectDrivesToggle: () => void
  trustReset: boolean
  onResetTrust: () => void
  inputClass: string
  labelClass: string
}

const ConnectionAdvanced: React.FC<ConnectionAdvancedProps> = ({
  defaultOpen,
  type,
  isEdit,
  argsPlaceholder,
  port,
  onPortChange,
  localArgs,
  onLocalArgsChange,
  folderOptions,
  parentId,
  onParentIdChange,
  rootLabel,
  showPasswordHelp,
  passwordHelpUrl,
  onPasswordHelpUrlChange,
  redirectDrives,
  onRedirectDrivesToggle,
  trustReset,
  onResetTrust,
  inputClass,
  labelClass,
}) => {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded-xl border border-theme-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-theme-dim hover:text-theme-fg transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <SlidersHorizontal className="w-3.5 h-3.5" />
        <span className="flex-1 text-left uppercase tracking-wider">Advanced</span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-theme-border px-3 py-2.5">
          {type !== 'LOCAL' && (
            <div className="space-y-0.5">
              <label className={labelClass}>Port</label>
              <input
                type="text"
                value={port}
                onChange={e => onPortChange(e.target.value)}
                placeholder={type === 'RDP' ? '3389' : '22'}
                className={inputClass}
              />
            </div>
          )}

          {type === 'LOCAL' && (
            <div className="space-y-0.5">
              <label className={labelClass}>Extra arguments</label>
              <input
                type="text"
                value={localArgs}
                onChange={e => onLocalArgsChange(e.target.value)}
                placeholder={argsPlaceholder}
                className={inputClass}
              />
            </div>
          )}

          {/* Parent Folder — the workspace's own directory tree, so a connection files itself next to
              the scripts it belongs with. */}
          <div className="space-y-0.5">
            <label className={labelClass}>Parent Folder</label>
            <select
              value={parentId}
              onChange={e => onParentIdChange(e.target.value)}
              className={`${inputClass} appearance-none`}
            >
              <option value="">{rootLabel}</option>
              {folderOptions.map(o => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>

          {showPasswordHelp && (
            <PasswordHelpField
              value={passwordHelpUrl}
              onChange={onPasswordHelpUrlChange}
              inputClass={inputClass}
              labelClass={labelClass}
            />
          )}

          {/* RDP file transfer — redirect local drives into the remote session so files can be copied
              both ways. Off by default: it lets the remote host read/write local files. */}
          {type === 'RDP' && (
            <div className="space-y-0.5">
              <label className={labelClass}>File Transfer</label>
              <ToggleRow
                label="Share local drives with remote"
                description="Lets the remote computer read/write files on your drives (upload/download)."
                checked={redirectDrives}
                onChange={onRedirectDrivesToggle}
                icon={<HardDrive className="w-4 h-4 shrink-0" />}
                ariaLabel="Share local drives with the remote session"
              />
            </div>
          )}

          {/* RDP security trust (edit mode) — clears the remembered "don't ask again" so the Remote
              Desktop warning prompts once again on the next connect. */}
          {isEdit && type === 'RDP' && (
            <div className="space-y-0.5">
              <label className={labelClass}>Security</label>
              <button
                type="button"
                onClick={onResetTrust}
                className={`w-full flex items-center justify-center gap-2 py-1.5 rounded-xl border transition-colors text-sm ${
                  trustReset
                    ? 'border-[#9ece6a] text-theme-success'
                    : 'border-theme-border text-theme-fg hover:border-[#e0af68] hover:text-theme-warning'
                }`}
              >
                <ShieldOff className="w-4 h-4" />
                {trustReset ? 'Trust reset — will prompt on next connect' : 'Reset security trust'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ConnectionAdvanced
