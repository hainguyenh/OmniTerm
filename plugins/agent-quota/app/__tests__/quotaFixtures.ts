import type { QuotaSnapshot } from '../../src/types'
import type { GuardState } from '../quotaGuard'
import type { ProfileQuota, TerminalAgent } from '../quotaStore'

import { DEFAULT_QUOTA_CONFIG, type QuotaConfig } from '../quotaConfig'
import { updateQuota } from '../quotaStore'

export const NOW = Date.UTC(2026, 8, 25, 3, 0)

export const terminal = (overrides: Partial<TerminalAgent> = {}): TerminalAgent => ({
  sessionId: 's1',
  agent: 'claude',
  pid: 10,
  startTime: 100,
  profileDir: 'C:\\p\\work',
  profileName: 'work',
  subAgentCount: 0,
  launcher: null,
  instanceKey: 's1:10:100',
  profileKey: 'claude:c:\\p\\work',
  ...overrides,
})

export const reading = (session: number, weekly = 30): QuotaSnapshot => ({
  windows: [
    { kind: 'session', label: 'Current session', usedPct: session, resetsAt: NOW + 3_600_000 },
    { kind: 'weekly', label: 'Current week', usedPct: weekly, resetsAt: NOW + 3 * 86_400_000 },
  ],
  fetchedAt: NOW,
  source: 'cli',
})

export const profile = (snapshot: QuotaSnapshot | undefined, overrides: Partial<ProfileQuota> = {}): ProfileQuota => ({
  key: 'claude:c:\\p\\work',
  agent: 'claude',
  profileName: 'work',
  profileDir: 'C:\\p\\work',
  launcher: null,
  snapshot,
  lastGood: snapshot && !snapshot.error ? snapshot : undefined,
  history: [],
  errorStreak: 0,
  nextFetchAt: 0,
  fetching: false,
  wake: {},
  waking: false,
  ...overrides,
})

interface Seed {
  config?: QuotaConfig
  terminals?: TerminalAgent[]
  profiles?: ProfileQuota[]
  guards?: Record<string, GuardState>
  available?: boolean
}

/** Put the store into a known state for a component test. */
export function seed({ config = DEFAULT_QUOTA_CONFIG, terminals = [terminal()], profiles = [profile(reading(40))], guards = {}, available = true }: Seed = {}) {
  updateQuota((state) => ({
    ...state,
    available,
    config,
    now: NOW,
    terminals: Object.fromEntries(terminals.map((entry) => [entry.sessionId, entry])),
    profiles: Object.fromEntries(profiles.map((entry) => [entry.key, entry])),
    guards,
  }))
}
