import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'

import { executeAction, getAction } from '../../ide/platform/actions'
import {
  useLspServersStore,
  type LspServerRecord,
  type NormalizedLspStatus,
} from './lspServersStore'

/** Installs a language server by name (the tools feature; it restarts the server when done). */
const INSTALL_ACTION = 'tools.install'

function StatusIndicatorIcon({ status }: { status: NormalizedLspStatus }) {
  if (status === 'Starting') {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 animate-spin rounded-full border border-current border-t-transparent text-[var(--accent)]"
      />
    )
  }
  if (status === 'Missing') {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-2 w-2 rounded-full bg-[var(--warning)]"
      />
    )
  }
  if (status === 'Failed') {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-2 w-2 rounded-full bg-[var(--danger)]"
      />
    )
  }
  if (status === 'Ready') {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-2 w-2 rounded-full bg-[var(--success)]"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-2 w-2 rounded-full bg-[var(--fg-muted)]"
    />
  )
}

function ServerCard({
  server,
  onRestart,
}: {
  server: LspServerRecord
  onRestart: (id: number) => void
}) {
  const [copied, setCopied] = useState(false)
  const canInstall = server.status === 'Missing' && !!getAction(INSTALL_ACTION)

  const handleCopy = (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  let statusBg = 'bg-[var(--bg-hover)] text-[var(--fg-muted)]'
  if (server.status === 'Ready') statusBg = 'bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[var(--success)]'
  else if (server.status === 'Starting') statusBg = 'bg-[color-mix(in_srgb,var(--info)_15%,transparent)] text-[var(--info)]'
  else if (server.status === 'Missing') statusBg = 'bg-[color-mix(in_srgb,var(--warning)_15%,transparent)] text-[var(--warning)]'
  else if (server.status === 'Failed') statusBg = 'bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] text-[var(--danger)]'

  return (
    <div
      data-testid="lsp-server-item"
      data-server-name={server.name}
      className="rounded border border-[var(--border)] bg-[var(--bg-elev)] p-2.5 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 truncate">
          <StatusIndicatorIcon status={server.status} />
          <span className="font-semibold text-[var(--fg)] truncate">{server.name}</span>
          {server.languages.length > 0 && (
            <span className="text-[10px] text-[var(--fg-muted)] truncate">
              ({server.languages.join(', ')})
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBg}`}>
            {server.status}
          </span>
          {canInstall ? (
            // Restarting a server that is not on this machine changes nothing: offer the install.
            <button
              type="button"
              data-testid="lsp-install-button"
              onClick={() => void executeAction(INSTALL_ACTION, server.name)}
              className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--fg-on-accent)] hover:opacity-90"
            >
              Install
            </button>
          ) : (
            <button
              type="button"
              data-testid="lsp-restart-button"
              onClick={() => onRestart(server.id)}
              className="rounded bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--fg)] hover:bg-[color-mix(in_srgb,var(--fg)_16%,transparent)]"
            >
              Restart
            </button>
          )}
        </div>
      </div>

      {(server.status === 'Missing' || server.status === 'Failed') && (
        <div
          data-testid="lsp-install-guidance"
          className="mt-2 rounded bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] p-2 text-[11px] text-[var(--fg)]"
        >
          <div className="font-medium text-[var(--warning)]">
            {server.status === 'Missing' ? 'Language server not found on PATH' : 'Server crashed or failed to start'}
          </div>
          {server.installHint ? (
            <div className="mt-1 flex items-center justify-between gap-2 rounded bg-[var(--bg-input)] px-2 py-1 font-mono text-[10px]">
              <span className="truncate">{server.installHint}</span>
              <button
                type="button"
                onClick={() => handleCopy(server.installHint!)}
                className="shrink-0 text-[10px] text-[var(--accent)] hover:underline"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          ) : (
            <p className="mt-1 text-[10px] text-[var(--fg-muted)]">
              {server.message || 'Please check your system PATH or configuration.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function LspStatusWidget() {
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const badgeRef = useRef<HTMLButtonElement>(null)
  // The popover is portalled to <body> and positioned from the badge: inside the status bar it sat
  // in a low stacking context, so tool windows and the editor island painted over the error text.
  const [anchor, setAnchor] = useState<{ right: number; bottom: number } | null>(null)

  const overallStatus = useLspServersStore((s) => s.overallStatus)
  const isRestarting = useLspServersStore((s) => s.isRestarting)
  const serversMap = useLspServersStore((s) => s.servers)
  const restartServer = useLspServersStore((s) => s.restartServer)
  const servers = [...serversMap.values()]

  // Close popover on outside click
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      const target = e.target as Node
      if (popoverRef.current && !popoverRef.current.contains(target) && !badgeRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const handleToggle = (e: MouseEvent) => {
    e.stopPropagation()
    const rect = badgeRef.current?.getBoundingClientRect()
    if (rect) setAnchor({ right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.top + 4 })
    setOpen((prev) => !prev)
  }

  const handleRestart = (id?: number) => {
    if (typeof id === 'number') {
      void executeAction('lsp.restart', id)
    } else {
      void executeAction('lsp.restart')
    }
  }

  // Label to show in status bar
  let displayLabel = 'LSP'
  if (isRestarting) {
    displayLabel = 'LSP: Restarting...'
  } else if (servers.length === 1 && servers[0]) {
    const s = servers[0]
    displayLabel = `${s.name}: ${s.status}`
  } else if (servers.length > 1) {
    displayLabel = `LSP (${servers.length}): ${overallStatus}`
  } else if (overallStatus !== 'Idle') {
    displayLabel = `LSP: ${overallStatus}`
  }

  let textStyle = 'text-[var(--fg-muted)]'
  if (overallStatus === 'Ready') textStyle = 'text-[var(--success)]'
  else if (overallStatus === 'Starting') textStyle = 'text-[var(--info)]'
  else if (overallStatus === 'Missing') textStyle = 'text-[var(--warning)]'
  else if (overallStatus === 'Failed') textStyle = 'text-[var(--danger)]'

  return (
    <div className="relative inline-flex items-center" data-testid="lsp-status-widget">
      <button
        ref={badgeRef}
        type="button"
        data-testid="lsp-status-badge"
        onClick={handleToggle}
        title={`Language Server Status: ${overallStatus}. Click for details.`}
        className="flex h-5 items-center gap-1.5 rounded px-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] focus:outline-none transition-colors"
      >
        <StatusIndicatorIcon status={overallStatus} />
        <span className={`text-[11px] select-none ${textStyle}`}>{displayLabel}</span>
      </button>

      {open && anchor && createPortal(
        <div
          ref={popoverRef}
          style={{ position: 'fixed', right: anchor.right, bottom: anchor.bottom, zIndex: 1000 }}
          data-testid="lsp-status-popover"
          className="w-72 max-w-[calc(100vw-16px)] rounded-lg border border-[var(--border)] bg-[var(--bg-popup)] p-3 shadow-xl text-[var(--fg)]"
        >
          <div className="mb-2.5 flex items-center justify-between border-b border-[var(--border)] pb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <StatusIndicatorIcon status={overallStatus} />
              <span>Language Servers</span>
            </div>
            <button
              type="button"
              data-testid="lsp-restart-all-button"
              onClick={() => handleRestart()}
              className="rounded bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg)] hover:bg-[color-mix(in_srgb,var(--fg)_16%,transparent)]"
            >
              Restart All
            </button>
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto">
            {servers.length === 0 ? (
              <div className="py-4 text-center text-xs text-[var(--fg-muted)]">
                <p>No active language servers detected.</p>
                <button
                  type="button"
                  onClick={() => void restartServer()}
                  className="mt-2 text-[11px] text-[var(--accent)] hover:underline"
                >
                  Discover / Restart Servers
                </button>
              </div>
            ) : (
              servers.map((server) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  onRestart={handleRestart}
                />
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
