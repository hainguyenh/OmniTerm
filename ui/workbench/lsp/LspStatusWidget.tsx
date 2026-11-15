import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'

import { executeAction } from '../../ide/platform/actions'
import {
  useLspServersStore,
  type LspServerRecord,
  type NormalizedLspStatus,
} from './lspServersStore'

function StatusIndicatorIcon({ status }: { status: NormalizedLspStatus }) {
  if (status === 'Starting') {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 animate-spin rounded-full border border-current border-t-transparent text-[var(--primary,#3b82f6)]"
      />
    )
  }
  if (status === 'Missing') {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-2 w-2 rounded-full bg-[var(--warning,#f59e0b)]"
      />
    )
  }
  if (status === 'Failed') {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-2 w-2 rounded-full bg-[var(--error,#ef4444)]"
      />
    )
  }
  if (status === 'Ready') {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-2 w-2 rounded-full bg-[var(--success,#22c55e)]"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-2 w-2 rounded-full bg-[var(--foreground-muted,#888)]"
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

  const handleCopy = (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  let statusBg = 'bg-[var(--surface-hover,rgba(255,255,255,0.08))] text-[var(--foreground-muted,#888)]'
  if (server.status === 'Ready') statusBg = 'bg-[var(--success-bg,rgba(34,197,94,0.15))] text-[var(--success,#22c55e)]'
  else if (server.status === 'Starting') statusBg = 'bg-[var(--info-bg,rgba(59,130,246,0.15))] text-[var(--info,#3b82f6)]'
  else if (server.status === 'Missing') statusBg = 'bg-[var(--warning-bg,rgba(245,158,11,0.15))] text-[var(--warning,#f59e0b)]'
  else if (server.status === 'Failed') statusBg = 'bg-[var(--error-bg,rgba(239,68,68,0.15))] text-[var(--error,#ef4444)]'

  return (
    <div
      data-testid="lsp-server-item"
      data-server-name={server.name}
      className="rounded border border-[var(--border-subtle,rgba(255,255,255,0.08))] bg-[var(--surface-base,rgba(255,255,255,0.02))] p-2.5 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 truncate">
          <StatusIndicatorIcon status={server.status} />
          <span className="font-semibold text-[var(--foreground,#eee)] truncate">{server.name}</span>
          {server.languages.length > 0 && (
            <span className="text-[10px] text-[var(--foreground-muted,#888)] truncate">
              ({server.languages.join(', ')})
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBg}`}>
            {server.status}
          </span>
          <button
            type="button"
            data-testid="lsp-restart-button"
            onClick={() => onRestart(server.id)}
            className="rounded bg-[var(--surface-hover,rgba(255,255,255,0.08))] px-1.5 py-0.5 text-[10px] text-[var(--foreground,#ddd)] hover:bg-[var(--surface-hover,rgba(255,255,255,0.15))]"
          >
            Restart
          </button>
        </div>
      </div>

      {(server.status === 'Missing' || server.status === 'Failed') && (
        <div
          data-testid="lsp-install-guidance"
          className="mt-2 rounded bg-[var(--warning-bg,rgba(245,158,11,0.08))] p-2 text-[11px] text-[var(--foreground,#ddd)]"
        >
          <div className="font-medium text-[var(--warning,#f59e0b)]">
            {server.status === 'Missing' ? 'Language server not found on PATH' : 'Server crashed or failed to start'}
          </div>
          {server.installHint ? (
            <div className="mt-1 flex items-center justify-between gap-2 rounded bg-[var(--surface-input,rgba(0,0,0,0.3))] px-2 py-1 font-mono text-[10px]">
              <span className="truncate">{server.installHint}</span>
              <button
                type="button"
                onClick={() => handleCopy(server.installHint!)}
                className="shrink-0 text-[10px] text-[var(--primary,#3b82f6)] hover:underline"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          ) : (
            <p className="mt-1 text-[10px] text-[var(--foreground-muted,#888)]">
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

  let textStyle = 'text-[var(--foreground-muted,#888)]'
  if (overallStatus === 'Ready') textStyle = 'text-[var(--success,#22c55e)]'
  else if (overallStatus === 'Starting') textStyle = 'text-[var(--info,#3b82f6)]'
  else if (overallStatus === 'Missing') textStyle = 'text-[var(--warning,#f59e0b)]'
  else if (overallStatus === 'Failed') textStyle = 'text-[var(--error,#ef4444)]'

  return (
    <div className="relative inline-flex items-center" data-testid="lsp-status-widget">
      <button
        ref={badgeRef}
        type="button"
        data-testid="lsp-status-badge"
        onClick={handleToggle}
        title={`Language Server Status: ${overallStatus}. Click for details.`}
        className="flex h-5 items-center gap-1.5 rounded px-1.5 text-xs font-medium hover:bg-[var(--surface-hover,rgba(255,255,255,0.08))] focus:outline-none transition-colors"
      >
        <StatusIndicatorIcon status={overallStatus} />
        <span className={`text-[11px] select-none ${textStyle}`}>{displayLabel}</span>
      </button>

      {open && anchor && createPortal(
        <div
          ref={popoverRef}
          style={{ position: 'fixed', right: anchor.right, bottom: anchor.bottom, zIndex: 1000 }}
          data-testid="lsp-status-popover"
          className="w-72 max-w-[calc(100vw-16px)] rounded-lg border border-[var(--border-subtle,rgba(255,255,255,0.12))] bg-[var(--surface-popup,#1e1e24)] p-3 shadow-xl text-[var(--foreground,#eee)]"
        >
          <div className="mb-2.5 flex items-center justify-between border-b border-[var(--border-subtle,rgba(255,255,255,0.08))] pb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <StatusIndicatorIcon status={overallStatus} />
              <span>Language Servers</span>
            </div>
            <button
              type="button"
              data-testid="lsp-restart-all-button"
              onClick={() => handleRestart()}
              className="rounded bg-[var(--surface-hover,rgba(255,255,255,0.08))] px-2 py-0.5 text-[10px] font-medium text-[var(--foreground,#ddd)] hover:bg-[var(--surface-hover,rgba(255,255,255,0.15))]"
            >
              Restart All
            </button>
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto">
            {servers.length === 0 ? (
              <div className="py-4 text-center text-xs text-[var(--foreground-muted,#888)]">
                <p>No active language servers detected.</p>
                <button
                  type="button"
                  onClick={() => void restartServer()}
                  className="mt-2 text-[11px] text-[var(--primary,#3b82f6)] hover:underline"
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
