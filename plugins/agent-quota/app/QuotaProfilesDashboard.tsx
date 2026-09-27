import { Check, Copy, RefreshCw, Sparkles, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { AgentKind, QuotaSnapshot, QuotaWindow } from '../src/types'
import type { ProfileAdvice, Recommendation } from './profileAdvisor'
import type { DashboardDeps, DashboardRow } from './profileDashboard'

import './profilesDashboard.css'
import { AgentIcon } from './QuotaLine'
import { adviseProfiles } from './profileAdvisor'
import {
  fetchDashboardProfiles,
  formatAgo,
  freshestReading,
  loadDashboardProfiles,
  setDashboardOpen,
  useProfileDashboard,
} from './profileDashboard'
import { AGENT_KINDS, AGENT_LABELS } from './quotaConfig'
import { formatCountdown, formatReset, windowOf, zoneFor } from './quotaPolicy'
import { getQuotaState, useCoarseNow, useQuota } from './quotaStore'

/** What to type to start a profile: its launcher, or the agent itself for the default profile. */
const commandFor = (row: DashboardRow) => row.launcher ?? row.agent

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = async () => {
    try {
      await (window.omnitermAPI?.clipboard?.writeText(command) ?? navigator.clipboard.writeText(command))
      setCopied(true)
    } catch {
      // Clipboard refused: the command stays visible to type by hand.
    }
  }
  return (
    <span className="aq-pd-command">
      <code>{command}</code>
      <button type="button" className="aq-icon-button" aria-label={`Copy ${command}`} title={copied ? 'Copied' : `Copy ${command}`} onClick={() => void copy()}>
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      </button>
    </span>
  )
}

function Banner({ advice, rows }: { advice: Recommendation; rows: Map<string, DashboardRow> }) {
  const row = (entry: ProfileAdvice | null) => (entry ? rows.get(entry.key) : undefined)
  const best = row(advice.best)
  if (advice.best && best) {
    const alternative = row(advice.alternative)
    return (
      <div className="aq-pd-banner" data-kind="best" role="status">
        <Sparkles className="w-4 h-4 shrink-0 text-theme-accent" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Use now: {best.profileName}</span>
            <CopyCommand command={commandFor(best)} />
          </div>
          <div className="text-theme-dim">{advice.best.reason}</div>
          {advice.alternative && alternative && (
            <div className="text-theme-dim">Next best: {alternative.profileName} — {advice.alternative.reason}</div>
          )}
        </div>
      </div>
    )
  }
  const next = row(advice.nextAvailable)
  if (advice.nextAvailable && next) {
    return (
      <div className="aq-pd-banner" data-kind="wait" role="status">
        <div className="flex-1 min-w-0">
          <span className="font-semibold">No profile has room right now.</span>
          <div className="text-theme-dim">{next.profileName} frees up first: {advice.nextAvailable.reason}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="aq-pd-banner" data-kind="empty" role="status">
      <span className="text-theme-dim">Press Fetch all to read every profile's quota and get a recommendation.</span>
    </div>
  )
}

function WindowCell({ label, window, limit, now }: { label: string; window: QuotaWindow | undefined; limit: number; now: number }) {
  if (!window) return <span className="aq-pd-cell text-theme-dim">{label} —</span>
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
      <span className="aq-pd-reset">{reset ? `resets ${reset}` : ' '}</span>
    </span>
  )
}

const STATUS_TEXT: Record<ProfileAdvice['status'], string> = { best: 'Use now', ok: 'OK', limited: 'Limited', noData: 'No data' }

function ProfileRow({ row, reading, advice, limits, now, deps }: {
  row: DashboardRow
  reading: QuotaSnapshot | undefined
  advice: ProfileAdvice
  limits: { session: number; weekly: number }
  now: number
  deps: DashboardDeps
}) {
  const wait = advice.status === 'limited' ? formatCountdown(advice.availableAt, now) : ''
  const status = row.error && advice.status === 'noData' ? 'Error' : wait ? `Limited · ${wait}` : STATUS_TEXT[advice.status]
  return (
    <li className="aq-pd-row" data-status={row.error && advice.status === 'noData' ? 'error' : advice.status} aria-label={`${row.profileName} profile`}>
      <span className="aq-pd-name">
        <span className="flex items-center gap-1.5 font-medium truncate">
          <AgentIcon agent={row.agent} />
          {row.profileName}
        </span>
        <span className="text-theme-dim truncate" title={row.error ?? advice.reason}>
          {row.fetching ? 'Fetching…' : row.error ? `Failed: ${row.error}` : reading ? `fetched ${formatAgo(reading.fetchedAt, now)}` : 'not fetched'}
        </span>
      </span>
      <WindowCell label="5h" window={windowOf(reading, 'session')} limit={limits.session} now={now} />
      <WindowCell label="Week" window={windowOf(reading, 'weekly')} limit={limits.weekly} now={now} />
      <span className="aq-pd-status-cell">
        <span className="aq-pd-status" title={advice.reason}>{status}</span>
        <button type="button" className="aq-icon-button" aria-label={`Fetch ${row.profileName}`} title={`Fetch ${row.profileName}`}
          disabled={row.fetching} onClick={() => void fetchDashboardProfiles(deps, [row.key])}
        >
          <RefreshCw className={`w-3 h-3 ${row.fetching ? 'animate-spin' : ''}`} />
        </button>
      </span>
    </li>
  )
}

function AgentGroup({ agent, rows, showHeading, deps, now }: { agent: AgentKind; rows: DashboardRow[]; showHeading: boolean; deps: DashboardDeps; now: number }) {
  const limits = useQuota((state) => state.config.agents[agent].limits)
  const engine = useQuota((state) => state.profiles)
  const readings = new Map(rows.map((row) => [row.key, freshestReading(row, engine)]))
  const advice = adviseProfiles(rows.map((row) => ({ key: row.key, name: row.profileName, reading: readings.get(row.key) })), limits, now)
  const byKey = new Map(rows.map((row) => [row.key, row]))
  return (
    <section className="flex flex-col gap-2" aria-label={`${AGENT_LABELS[agent]} profiles`}>
      {showHeading && <span className="text-[10px] uppercase font-bold tracking-widest text-theme-dim">{AGENT_LABELS[agent]}</span>}
      <Banner advice={advice} rows={byKey} />
      <ul className="flex flex-col gap-1">
        {advice.ranked.map((entry) => {
          const row = byKey.get(entry.key)
          return row ? <ProfileRow key={entry.key} row={row} reading={readings.get(entry.key)} advice={entry} limits={limits} now={now} deps={deps} /> : null
        })}
      </ul>
    </section>
  )
}

/**
 * The Profiles dashboard: every profile the user can start, its 5h and weekly quota with reset
 * times, and which one to use now (profileAdvisor.ts). View only, and read only on request — the
 * list is discovered on open, quota is read when the user presses Fetch.
 */
export function QuotaProfilesDashboard({ deps }: { deps: DashboardDeps }) {
  const rows = useProfileDashboard((state) => state.rows)
  const listing = useProfileDashboard((state) => state.listing)
  const fetchingAll = useProfileDashboard((state) => state.fetchingAll)
  const now = useCoarseNow()

  useEffect(() => {
    void loadDashboardProfiles(deps, getQuotaState().profiles)
  }, [deps])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDashboardOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const agents = AGENT_KINDS.filter((agent) => rows.some((row) => row.agent === agent))
  const busy = fetchingAll || rows.some((row) => row.fetching)
  return (
    <div className="aq-pd-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDashboardOpen(false) }}>
      <div role="dialog" aria-modal="true" aria-label="Agent profiles" className="aq-pd-dialog">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-theme-accent" />
          <div className="flex-1 min-w-0">
            <div className="font-bold tracking-wide">Profiles</div>
            <div className="text-theme-dim">
              {listing && rows.length === 0 ? 'Looking for profiles…' : `${rows.length} profile${rows.length === 1 ? '' : 's'} · quota is read only when you fetch`}
            </div>
          </div>
          <button type="button" disabled={rows.length === 0 || busy} onClick={() => void fetchDashboardProfiles(deps)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-theme-border hover:border-theme-accent disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Fetching…' : 'Fetch all'}
          </button>
          <button type="button" aria-label="Close profiles" className="aq-icon-button" onClick={() => setDashboardOpen(false)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto min-h-0">
          {!listing && rows.length === 0 && (
            <span className="text-theme-dim">No profiles found. Profiles are ~/.claude and launchers such as claude-work on your PATH.</span>
          )}
          {agents.map((agent) => (
            <AgentGroup key={agent} agent={agent} rows={rows.filter((row) => row.agent === agent)} showHeading={agents.length > 1} deps={deps} now={now} />
          ))}
        </div>
      </div>
    </div>
  )
}
