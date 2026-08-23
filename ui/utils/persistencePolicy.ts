export type TerminalPersistencePolicy =
  | 'close-with-app'
  | 'keep-running'
  | 'recover-after-reboot'
  | 'freeze-while-closed'

const STORAGE_KEY = 'omniterm:terminal-persistence-policies'
const VALID = new Set<TerminalPersistencePolicy>([
  'close-with-app',
  'keep-running',
  'recover-after-reboot',
  'freeze-while-closed',
])

type StoredPolicies = Record<string, TerminalPersistencePolicy>

function readPolicies(): StoredPolicies {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: StoredPolicies = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && VALID.has(value as TerminalPersistencePolicy)) {
        result[id] = value as TerminalPersistencePolicy
      }
    }
    return result
  } catch {
    return {}
  }
}

export function hasExplicitPersistencePolicy(sessionId: string): boolean {
  return readPolicies()[sessionId] !== undefined
}

export function getPersistencePolicy(sessionId: string): TerminalPersistencePolicy {
  return readPolicies()[sessionId] ?? 'close-with-app'
}

export function setPersistencePolicyOverride(
  sessionId: string,
  policy: TerminalPersistencePolicy,
): void {
  try {
    const policies = readPolicies()
    policies[sessionId] = policy
    localStorage.setItem(STORAGE_KEY, JSON.stringify(policies))
  } catch {
    // Persistence preferences are best effort; the daemon still receives the live update.
  }
}

export function isPersistencePolicy(value: unknown): value is TerminalPersistencePolicy {
  return typeof value === 'string' && VALID.has(value as TerminalPersistencePolicy)
}
