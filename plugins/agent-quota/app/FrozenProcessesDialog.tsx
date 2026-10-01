import { AlertCircle, ChevronDown, ChevronRight, Play, Snowflake, Square, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { FrozenProcess } from './agentQuotaAPI'
import { createAgentQuotaAPI } from './agentQuotaAPI'
import { useDialogDrag } from './dialogDrag'
import { AGENT_LABELS } from './quotaConfig'
import { formatCountdown } from './quotaPolicy'
import { quotaCommands, setReviewSession, useQuota } from './quotaStore'

/**
 * Review modal dialog showing every process and thread suspended under the current agent profile.
 * Allows the user to inspect PIDs, suspended threads, elapsed runtimes, and to thaw or terminate them.
 */
export function FrozenProcessesDialog() {
  const reviewSessionId = useQuota((state) => state.reviewSessionId)
  const terminal = useQuota((state) => (reviewSessionId ? state.terminals[reviewSessionId] : undefined))
  const guard = useQuota((state) => (terminal ? state.guards[terminal.instanceKey] : undefined))
  const now = useQuota((state) => state.now)

  const [processes, setProcesses] = useState<FrozenProcess[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedPids, setExpandedPids] = useState<Set<number>>(new Set())
  const [actionPid, setActionPid] = useState<number | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const drag = useDialogDrag(dialogRef)
  const api = useMemo(() => createAgentQuotaAPI(), [])

  useEffect(() => {
    if (!reviewSessionId) {
      setProcesses([])
      setLoading(true)
      return
    }

    let active = true
    setLoading(true)

    const fetchHeld = api.getHeld ? api.getHeld(reviewSessionId) : Promise.resolve([])
    fetchHeld
      .then((held) => {
        if (!active) return
        if (held.length > 0) {
          setProcesses(held)
        } else if (terminal) {
          setProcesses([{
            pid: terminal.pid,
            startTime: terminal.startTime,
            image: terminal.agent === 'claude' ? 'claude.exe' : `${terminal.agent}.exe`,
            profileName: terminal.profileName,
            threads: [],
          }])
        }
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        if (terminal) {
          setProcesses([{
            pid: terminal.pid,
            startTime: terminal.startTime,
            image: terminal.agent === 'claude' ? 'claude.exe' : `${terminal.agent}.exe`,
            profileName: terminal.profileName,
            threads: [],
          }])
        }
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [reviewSessionId, terminal, api])

  useEffect(() => {
    if (!reviewSessionId) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setReviewSession(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reviewSessionId])

  if (!reviewSessionId || !terminal) return null

  const handleClose = () => setReviewSession(null)

  const handleResumeAll = () => {
    quotaCommands().resume(reviewSessionId)
    handleClose()
  }

  const handleResumePid = async (pid: number) => {
    setActionPid(pid)
    try {
      const ok = api.resumePid ? await api.resumePid(reviewSessionId, pid) : false
      if (ok) {
        setProcesses((prev) => {
          const next = prev.filter((p) => p.pid !== pid)
          if (next.length === 0) {
            handleClose()
          }
          return next
        })
      }
    } finally {
      setActionPid(null)
    }
  }

  const handleTerminatePid = async (pid: number, startTime: number) => {
    setActionPid(pid)
    try {
      await api.terminate(reviewSessionId, pid, startTime)
      setProcesses((prev) => {
        const next = prev.filter((p) => p.pid !== pid)
        if (next.length === 0) {
          handleClose()
        }
        return next
      })
    } finally {
      setActionPid(null)
    }
  }

  const toggleExpand = (pid: number) => {
    setExpandedPids((prev) => {
      const next = new Set(prev)
      if (next.has(pid)) next.delete(pid)
      else next.add(pid)
      return next
    })
  }

  const totalThreads = processes.reduce((acc, p) => acc + (p.threads?.length ?? 0), 0)
  const countdown = guard?.resetsAt ? formatCountdown(guard.resetsAt, now) : null

  return (
    <div
      className="aq-pd-backdrop"
      data-testid="aq-frozen-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Suspended processes review"
        className="aq-pd-dialog"
        style={{ ...drag.style, maxWidth: '36rem' }}
        data-testid="aq-frozen-dialog"
      >
        {/* Drag header */}
        <div
          className="aq-pd-handle flex items-center gap-2 border-b border-theme-border pb-3"
          data-testid="aq-frozen-handle"
          title="Drag to move"
          {...drag.handleProps}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-theme-warning/15 text-theme-warning">
            <Snowflake className="h-4 w-4 animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-wide text-theme-fg">Suspended Processes</span>
              <span className="rounded bg-theme-warning/20 px-1.5 py-0.2 text-[10px] font-semibold text-theme-warning">
                Frozen
              </span>
            </div>
            <div className="text-[11px] text-theme-dim truncate">
              {terminal.profileName} ({AGENT_LABELS[terminal.agent]})
            </div>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            className="flex h-6 w-6 items-center justify-center rounded text-theme-dim hover:bg-theme-bg hover:text-theme-fg transition-colors"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Status notice */}
        <div className="flex items-center justify-between rounded-lg bg-theme-bg/60 p-2.5 border border-theme-border/60 text-xs">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-theme-warning shrink-0" />
            <span className="text-theme-fg">
              {processes.length} process{processes.length === 1 ? '' : 'es'} · {totalThreads} thread{totalThreads === 1 ? '' : 's'} suspended
            </span>
          </div>
          {countdown && (
            <span className="font-mono text-theme-warning font-semibold">
              Resumes in {countdown}
            </span>
          )}
        </div>

        {/* Process list */}
        <div className="flex flex-col gap-2 overflow-y-auto max-h-[45vh] pr-1">
          {loading ? (
            <div className="py-6 text-center text-xs text-theme-dim">Scanning frozen processes…</div>
          ) : processes.length === 0 ? (
            <div className="py-6 text-center text-xs text-theme-dim">No suspended processes found for this profile.</div>
          ) : (
            processes.map((proc) => {
              const threads = proc.threads ?? []
              const isExpanded = expandedPids.has(proc.pid)
              const isBusy = actionPid === proc.pid

              return (
                <div
                  key={proc.pid}
                  className="flex flex-col rounded-lg border border-theme-border bg-theme-bg/30 p-2.5 transition-colors hover:border-theme-border/90"
                  data-testid={`aq-frozen-proc-${proc.pid}`}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="text-theme-dim hover:text-theme-fg p-0.5"
                      onClick={() => toggleExpand(proc.pid)}
                      aria-label={isExpanded ? 'Collapse threads' : 'Expand threads'}
                      title={isExpanded ? 'Collapse thread list' : 'View suspended thread IDs'}
                    >
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-theme-fg">{proc.image}</span>
                        <span className="rounded bg-theme-bg px-1.5 py-0.5 font-mono text-[10px] text-theme-dim border border-theme-border/50">
                          PID {proc.pid}
                        </span>
                        {proc.profileName && (
                          <span className="rounded bg-theme-accent/10 px-1.5 py-0.5 text-[10px] text-theme-accent border border-theme-accent/20">
                            {proc.profileName}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-theme-dim mt-0.5">
                        {threads.length > 0 ? `${threads.length} threads suspended` : 'Main thread suspended'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleResumePid(proc.pid)}
                        className="inline-flex items-center gap-1 rounded border border-theme-border px-2 py-1 text-[11px] text-theme-fg hover:border-theme-accent hover:text-theme-accent disabled:opacity-50 transition-colors"
                        title="Thaw this process"
                      >
                        <Play className="h-3 w-3" /> Resume
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleTerminatePid(proc.pid, proc.startTime)}
                        className="inline-flex items-center gap-1 rounded border border-theme-border px-2 py-1 text-[11px] text-theme-error hover:border-theme-error hover:bg-theme-error/10 disabled:opacity-50 transition-colors"
                        title="Terminate this process"
                      >
                        <Square className="h-3 w-3" /> Stop
                      </button>
                    </div>
                  </div>

                  {/* Expanded thread IDs */}
                  {isExpanded && threads.length > 0 && (
                    <div className="mt-2.5 pt-2 border-t border-theme-border/40 flex flex-wrap gap-1 items-center">
                      <span className="text-[10px] text-theme-dim mr-1">Suspended Thread IDs:</span>
                      {threads.map((tid) => (
                        <span
                          key={tid}
                          className="rounded bg-theme-bg px-1.5 py-0.5 font-mono text-[10px] text-theme-dim border border-theme-border/40"
                        >
                          TID {tid}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between border-t border-theme-border pt-3 mt-1">
          <div className="text-[11px] text-theme-dim">
            Press <kbd className="rounded bg-theme-bg px-1 py-0.5 font-mono text-[10px] border border-theme-border">ESC</kbd> to dismiss
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded border border-theme-border px-3 py-1.5 text-xs text-theme-fg hover:border-theme-accent transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleResumeAll}
              className="inline-flex items-center gap-1.5 rounded bg-theme-accent px-3 py-1.5 text-xs font-medium text-theme-accent-fg hover:bg-theme-accent/90 transition-colors"
            >
              <Play className="h-3.5 w-3.5 fill-current" /> Resume All Processes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
