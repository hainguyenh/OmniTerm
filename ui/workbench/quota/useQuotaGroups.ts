import { useMemo } from 'react'

import { getQuotaNow, useCoarseNow, useQuota } from '../../features/agent-quota/quotaStore'

import { activeQuotaSession, footerProfiles, nearestReset, quotaGroups } from './quotaModel'
import { useActiveSessionId } from './useActiveSessionId'

/**
 * The quota groups and the active session they follow, recomputed when either changes. The clock
 * is coarse (30s, by the second only near a reset), so the always-visible status bar does not
 * re-render every second.
 */
export function useQuotaGroups() {
  const sessionId = useActiveSessionId()
  const terminals = useQuota((state) => state.terminals)
  const profiles = useQuota((state) => state.profiles)
  const deadline = useMemo(() => nearestReset(profiles, getQuotaNow()), [profiles])
  const now = useCoarseNow(deadline)
  const active = useMemo(() => activeQuotaSession({ terminals }, sessionId), [terminals, sessionId])
  const groups = useMemo(() => quotaGroups({ profiles, now }, active), [profiles, now, active])
  return { sessionId, active, groups }
}

/** The status bar's profiles (running ones, nearest their 5h limit first), on the same clock. */
export function useFooterProfiles() {
  const sessionId = useActiveSessionId()
  const terminals = useQuota((state) => state.terminals)
  const profiles = useQuota((state) => state.profiles)
  const deadline = useMemo(() => nearestReset(profiles, getQuotaNow()), [profiles])
  const now = useCoarseNow(deadline)
  return useMemo(
    () => footerProfiles({ terminals, profiles, now }, activeQuotaSession({ terminals }, sessionId)),
    [terminals, profiles, now, sessionId],
  )
}
