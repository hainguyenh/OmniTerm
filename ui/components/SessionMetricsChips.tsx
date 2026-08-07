import React, { useEffect, useState } from 'react'
import { Activity, Cpu, MemoryStick, HardDrive, Clock } from 'lucide-react'
import { SessionStatus } from './MainLayout'

// ── Session metrics footer chips ────────────────────────────────────────────────
// Small pills shown in the footer for the focused session: latency (SSH + RDP),
// remote CPU / RAM / disk (SSH only, hidden while null), and uptime. A `compact`
// variant (used in split view) trims padding and units so the row fits a narrow
// footer that follows the focused pane.

interface MetricChipProps {
  icon: React.ReactNode
  value: string
  colorClass: string
  title: string
  compact?: boolean
}

const MetricChip: React.FC<MetricChipProps> = ({ icon, value, colorClass, title, compact }) => (
  <span
    className={`inline-flex items-center rounded-full flex-shrink-0 bg-theme-bg font-medium ${
      compact ? 'gap-0.5 px-1.5 py-0.5 text-[11px]' : 'gap-1 px-2 py-0.5 text-xs'
    } ${colorClass}`}
    title={title}
  >
    {icon}
    {value}
  </span>
)

/** Uptime pill with its own 1s ticker so the parent doesn't re-render every second. */
const UptimeChip: React.FC<{ since: number; compact?: boolean }> = ({ since, compact }) => {
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = Math.max(0, Math.floor((Date.now() - since) / 1000))
  return (
    <MetricChip
      icon={<Clock className="w-3 h-3" />}
      value={formatUptime(secs)}
      colorClass="text-theme-fg"
      title="Session uptime"
      compact={compact}
    />
  )
}

function formatUptime(secs: number): string {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

function formatGiB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1)
}

// Threshold → Tokyo Night color. good < warn ≤ amber < bad.
function thresholdColor(pct: number, warn: number, bad: number): string {
  return pct < warn ? 'text-theme-success' : pct < bad ? 'text-theme-warning' : 'text-theme-error'
}

interface MetricsChipsProps {
  status: SessionStatus
  latency: number | null       // resolved: RDP uses its own probe, SSH uses metrics.latency
  metrics?: SessionMetrics      // SSH remote stats (undefined until first tick / RDP)
  connectedAt?: number
  compact?: boolean
}

const MetricsChips: React.FC<MetricsChipsProps> = ({ status, latency, metrics, connectedAt, compact }) => {
  if (status !== 'connected') return null

  const latColor = latency == null ? 'text-theme-dim'
    : latency < 60 ? 'text-theme-success'
    : latency < 150 ? 'text-theme-warning'
    : 'text-theme-error'

  const cpu = metrics?.cpu ?? null
  const memUsed = metrics?.memUsed ?? null
  const memTotal = metrics?.memTotal ?? null
  const disk = metrics?.diskUsedPct ?? null
  const memPct = memUsed != null && memTotal ? (100 * memUsed) / memTotal : null

  return (
    <div className={`flex items-center flex-shrink-0 ${compact ? 'gap-1' : 'gap-2'}`}>
      <MetricChip
        icon={<Activity className="w-3 h-3" />}
        value={latency == null ? '—' : `${latency}${compact ? '' : ' ms'}`}
        colorClass={latColor}
        title="TCP latency to host"
        compact={compact}
      />
      {cpu != null && (
        <MetricChip
          icon={<Cpu className="w-3 h-3" />}
          value={`${cpu}%`}
          colorClass={thresholdColor(cpu, 60, 85)}
          title="Remote CPU usage"
          compact={compact}
        />
      )}
      {memUsed != null && memTotal != null && (
        <MetricChip
          icon={<MemoryStick className="w-3 h-3" />}
          value={compact ? `${formatGiB(memUsed)}/${formatGiB(memTotal)}` : `${formatGiB(memUsed)}/${formatGiB(memTotal)} GB`}
          colorClass={memPct == null ? 'text-theme-fg' : thresholdColor(memPct, 60, 85)}
          title="Remote memory used / total"
          compact={compact}
        />
      )}
      {disk != null && (
        <MetricChip
          icon={<HardDrive className="w-3 h-3" />}
          value={`${disk}%`}
          colorClass={thresholdColor(disk, 80, 90)}
          title="Remote root filesystem usage"
          compact={compact}
        />
      )}
      {connectedAt != null && <UptimeChip since={connectedAt} compact={compact} />}
    </div>
  )
}

export default MetricsChips
