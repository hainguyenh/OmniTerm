import { isHeld } from './quotaGuard'
import { setQuickOpen, useQuota } from './quotaStore'

export interface QuotaActivityEntry {
  label: string
  /** Monitoring is turned on — lit like Blur/Always Awake, independent of whether the popover is open. */
  active: boolean
  /** The quick-settings popover is open right now — a separate, transient pressed state. */
  open: boolean
  /** Some agent is frozen right now. */
  alert: boolean
  onClick: () => void
}

/**
 * The pinned quick-settings icon for the activity bar, or null when the plugin is absent or the
 * user unpinned it. The bar renders it with its own icon style.
 */
export function useQuotaActivityEntry(): QuotaActivityEntry | null {
  const available = useQuota((state) => state.available)
  const pinned = useQuota((state) => state.config.pinned)
  const enabled = useQuota((state) => state.config.enabled)
  const quickOpen = useQuota((state) => state.quickOpen)
  const profileCount = useQuota((state) => Object.keys(state.profiles).length)
  const alert = useQuota((state) => Object.values(state.guards).some(isHeld))
  if (!available || !pinned) return null
  const status = alert
    ? 'an agent is suspended'
    : enabled
      ? (profileCount > 0 ? `on · ${profileCount} profile${profileCount === 1 ? '' : 's'}` : 'on')
      : 'off'
  return {
    label: `Agent Quota: ${status}`,
    active: enabled,
    open: quickOpen,
    alert,
    onClick: () => setQuickOpen(!quickOpen),
  }
}
