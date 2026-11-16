import type { QuotaConfig } from './quotaConfig'

/**
 * Where the quota shows, as one choice over the two stored flags: `pinned` (the quick-settings icon
 * in the activity bar) and `footer` (one chip per agent profile on the footer line).
 */
export type QuotaPlacement = 'activity' | 'footer' | 'both' | 'hidden'

export function placementOf(config: Pick<QuotaConfig, 'pinned' | 'footer'>): QuotaPlacement {
  if (config.pinned && config.footer) return 'both'
  if (config.pinned) return 'activity'
  return config.footer ? 'footer' : 'hidden'
}

export function withPlacement<T extends Pick<QuotaConfig, 'pinned' | 'footer'>>(config: T, placement: QuotaPlacement): T {
  return { ...config, pinned: placement === 'activity' || placement === 'both', footer: placement === 'footer' || placement === 'both' }
}
