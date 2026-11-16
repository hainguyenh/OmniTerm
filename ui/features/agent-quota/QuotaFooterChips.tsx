import { useMemo } from 'react'

import './agentQuota.css'
import { footerChips } from './footerChips'
import { isHeld } from './quotaGuard'
import { setQuickOpen, useQuota } from './quotaStore'

/**
 * The footer display mode: a small line of chips, one per agent profile with a running terminal,
 * showing its used percent. Renders nothing unless the plugin is present, enabled and the footer
 * mode is on, so the layout reserves no row for it otherwise.
 */
export function QuotaFooterChips() {
  const available = useQuota((state) => state.available)
  const config = useQuota((state) => state.config)
  const terminals = useQuota((state) => state.terminals)
  const profiles = useQuota((state) => state.profiles)
  const guards = useQuota((state) => state.guards)
  const chips = useMemo(
    () => footerChips({ terminals, profiles, config }, (key) => isHeld(guards[key])),
    [terminals, profiles, config, guards],
  )
  if (!available || !config.enabled || !config.footer || chips.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] border-t border-[var(--theme-border)] flex-shrink-0" data-testid="aq-footer-chips">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => setQuickOpen(true)}
          title={`${chip.profileName}${chip.usedPct === null ? ': no reading yet' : `: ${chip.usedPct}% of the session used`}`}
          className={`inline-flex items-center gap-1 rounded-full border px-1.5 leading-4 hover:border-theme-accent ${
            chip.alert ? 'border-theme-error text-theme-error' : 'border-[var(--theme-border)] text-theme-dim'
          }`}
        >
          <span className="font-semibold">{chip.tag}</span>
          <span>{chip.usedPct === null ? '–' : `${chip.usedPct}%`}</span>
        </button>
      ))}
    </div>
  )
}
