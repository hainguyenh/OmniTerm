import { Users, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import type { AgentKind, QuotaSnapshot, QuotaWindow } from '../src/types'
import type { AgentQuotaAPI } from './agentQuotaAPI'
import type { ProfileAdvice } from './profileAdvisor'
import type { DashboardRow } from './profileDashboard'

import './profilesDashboard.css'
import { AgentIcon } from './QuotaLine'
import { createAgentQuotaAPI, listAgentProfiles } from './agentQuotaAPI'
import { useDialogDrag } from './dialogDrag'
import { adviseProfiles } from './profileAdvisor'
import { dashboardRows, fetchAllProfiles, fetchProfileRow, setDashboardOpen, setDiscoveredProfiles, useProfileDashboard } from './profileDashboard'
import { AGENT_KINDS, AGENT_LABELS } from './quotaConfig'
import { formatCountdown, formatReset, windowOf, zoneFor } from './quotaPolicy'
import { useCoarseNow, useQuota } from './quotaStore'

function WindowCell({ label, window, limit, now }: { label: string; window: QuotaWindow | undefined; limit: number; now: number }) {
  if (!window) {
    return (
      <span className="aq-pd-cell text-theme-dim" aria-label={`${label} —`}>
        <span className="aq-pd-cell-head">
          <span>{label} —</span>
        </span>
        <span className="aq-pd-bar">
          <span className="aq-pd-limit" style={{ left: `${limit}%` }} />
        </span>
        <span className="aq-pd-reset">&nbsp;</span>
      </span>
    )
  }
  const used = window.resetsAt !== undefined && window.resetsAt <= now ? 0 : window.usedPct
  const reset = formatReset(window.resetsAt, now)
  return (
    <span className="aq-pd-cell" aria-label={`${label} ${Math.round(used)}% used`}>
      <span className="aq-pd-cell-head">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(used)}%</span>
      </span>
      <span className="aq-pd-bar">
        <span className="aq-pd-fill" style={{ width: `${Math.min(100, used)}%`, background: `var(--aq-${zoneFor(used, limit)})` }} />
        <span className="aq-pd-limit" style={{ left: `${limit}%` }} />
      </span>
      <span className="aq-pd-reset">{reset ? `resets ${reset}` : '\u00A0'}</span>
    </span>
  )
}

const STATUS_TEXT: Record<ProfileAdvice['status'], string> = { best: 'Suggested', ok: 'Ready', limited: 'Limited', noData: 'No data' }

function ProfileRow({ row, reading, advice, limits, now, onFetch }: {
  row: DashboardRow
  reading: QuotaSnapshot | undefined
  advice: ProfileAdvice
  limits: { session: number; weekly: number }
  now: number
  onFetch?: () => void
}) {
  const wait = advice.status === 'limited' ? formatCountdown(advice.availableAt, now) : ''
  const status = row.error && advice.status === 'noData' ? 'Error' : wait ? `Limited · ${wait}` : STATUS_TEXT[advice.status]
  const activity = row.activeTerminalCount > 0
    ? `${row.activeTerminalCount} active terminal${row.activeTerminalCount === 1 ? '' : 's'}`
    : 'inactive'
  const detail = row.fetching
    ? 'Updating quota…'
    : row.error
      ? `${row.error}${reading ? ' · showing last good reading' : ''}`
      : reading
        ? `updated ${formatAgo(reading.fetchedAt, now)}`
        : 'waiting for first quota reading'
  return (
    <li className="aq-pd-row" data-status={row.error && advice.status === 'noData' ? 'error' : advice.status} aria-label={`${row.profileName} profile`}>
      <span className="aq-pd-name">
        <span className="flex items-center gap-1.5 font-medium truncate">
          <AgentIcon agent={row.agent} />
          {row.profileName}
        </span>
        <span className="text-theme-dim truncate" title={row.error ?? advice.reason}>{activity} · {detail}</span>
      </span>
      <WindowCell label="5h" window={windowOf(reading, 'session')} limit={limits.session} now={now} />
      <WindowCell label="Week" window={windowOf(reading, 'weekly')} limit={limits.weekly} now={now} />
      <span className="aq-pd-status-cell flex items-center gap-1.5 justify-end">
        <span className="aq-pd-status" title={advice.reason}>{status}</span>
        {onFetch && (
          <button
            type="button"
            aria-label={`Fetch quota for ${row.profileName}`}
            disabled={row.fetching}
            className="px-2 py-0.5 rounded text-[11px] border border-theme-border hover:border-theme-accent hover:text-theme-accent disabled:opacity-40 transition-colors"
            onClick={onFetch}
          >
            {row.fetching ? 'Fetching…' : 'Fetch'}
          </button>
        )}
      </span>
    </li>
  )
}

function AgentGroup({ agent, rows, showHeading, now, onFetch }: {
  agent: AgentKind
  rows: DashboardRow[]
  showHeading: boolean
  now: number
  onFetch: (row: DashboardRow) => void
}) {
  const limits = useQuota((state) => state.config.agents[agent].limits)
  const advice = adviseProfiles(rows.map((row) => ({ key: row.key, name: row.profileName, reading: row.reading })), limits, now)
  const byKey = new Map(rows.map((row) => [row.key, row]))
  return (
    <section className="flex flex-col gap-2" aria-label={`${AGENT_LABELS[agent]} profiles`}>
      {showHeading && <span className="text-[10px] uppercase font-bold tracking-widest text-theme-dim">{AGENT_LABELS[agent]}</span>}
      <ul className="flex flex-col gap-1">
        {advice.ranked.map((entry) => {
          const row = byKey.get(entry.key)
          return row ? <ProfileRow key={entry.key} row={row} reading={row.reading} advice={entry} limits={limits} now={now} onFetch={() => onFetch(row)} /> : null
        })}
      </ul>
    </section>
  )
}

/** The live Profiles view: one row per active profile, sourced from the quota engine snapshot. */
export function QuotaProfilesDashboard({ api }: { api?: AgentQuotaAPI } = {}) {
  const quotaApi = useRef(api ?? createAgentQuotaAPI()).current
  const profiles = useQuota((current) => current.profiles)
  const terminals = useQuota((current) => current.terminals)
  const discovered = useProfileDashboard((current) => current.discovered)
  const manualReadings = useProfileDashboard((current) => current.manualReadings)
  const rows = dashboardRows({ profiles, terminals }, discovered, manualReadings)
  const now = useCoarseNow()
  const dialogRef = useRef<HTMLDivElement>(null)
  const drag = useDialogDrag(dialogRef)

  useEffect(() => {
    void (quotaApi.listProfiles ? quotaApi.listProfiles() : listAgentProfiles()).then(setDiscoveredProfiles)
  }, [quotaApi])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDashboardOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleFetch = (row: DashboardRow) => {
    void fetchProfileRow(row, quotaApi)
  }

  const handleFetchAll = () => {
    void fetchAllProfiles(rows, quotaApi)
  }

  const activeCount = rows.filter((r) => r.activeTerminalCount > 0).length
  const inactiveCount = rows.filter((r) => r.activeTerminalCount === 0).length
  const isFetchingAll = rows.some((r) => r.fetching)
  const canFetchAll = !isFetchingAll && rows.length > 0
  const summary = inactiveCount === 0
    ? `${activeCount} active profile${activeCount === 1 ? '' : 's'} · live engine status`
    : `${activeCount} active · ${inactiveCount} inactive`

  const agents = AGENT_KINDS.filter((agent) => rows.some((row) => row.agent === agent))
  return (
    <div className="aq-pd-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDashboardOpen(false) }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Active agent profiles" className="aq-pd-dialog" style={drag.style}>
        <div className="aq-pd-handle flex items-center gap-2" data-testid="aq-pd-handle" title="Drag to move" {...drag.handleProps}>
          <Users className="w-4 h-4 text-theme-accent" />
          <div className="flex-1 min-w-0">
            <div className="font-bold tracking-wide">Profiles</div>
            <div className="text-theme-dim">{summary}</div>
          </div>
          {rows.length > 0 && (
            <button
              type="button"
              aria-label="Fetch all"
              disabled={!canFetchAll}
              className="px-2 py-0.5 rounded text-[11px] border border-theme-border hover:border-theme-accent hover:text-theme-accent disabled:opacity-40 transition-colors"
              onClick={handleFetchAll}
            >
              {isFetchingAll ? 'Fetching…' : 'Fetch all'}
            </button>
          )}
          <button type="button" aria-label="Close profiles" className="aq-icon-button" onClick={() => setDashboardOpen(false)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto min-h-0">
          {rows.length === 0 && <span className="text-theme-dim">No Claude Code profile is active in an open terminal.</span>}
          {agents.map((agent) => (
            <AgentGroup key={agent} agent={agent} rows={rows.filter((row) => row.agent === agent)} showHeading={agents.length > 1} now={now} onFetch={handleFetch} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** `just now`, `12m ago`, `3h ago`, `2d ago` — how old a reading is. */
function formatAgo(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}
