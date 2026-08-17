import { useEffect, useState } from 'react'
import {
  getPersistencePolicy,
  setPersistencePolicyOverride,
  type TerminalPersistencePolicy,
} from '../utils/persistencePolicy'

interface SessionPersistenceMenuProps {
  sessionId: string
  isAgent: boolean
}

const LABELS: Record<TerminalPersistencePolicy, string> = {
  'close-with-app': 'Close with OmniTerm',
  'keep-running': 'Keep running',
  'recover-after-reboot': 'Recover after reboot',
}

export default function SessionPersistenceMenu({
  sessionId,
  isAgent,
}: SessionPersistenceMenuProps) {
  const [policy, setPolicy] = useState(() => getPersistencePolicy(sessionId, isAgent))

  useEffect(() => {
    setPolicy(getPersistencePolicy(sessionId, isAgent))
  }, [isAgent, sessionId])

  const changePolicy = (next: TerminalPersistencePolicy) => {
    setPolicy(next)
    setPersistencePolicyOverride(sessionId, next)
    const update = window.omnitermAPI?.connect?.setPersistencePolicy?.(sessionId, next)
    void update?.catch(() => {})
  }

  return (
    <select
      aria-label="Session persistence"
      title={`Session persistence: ${LABELS[policy]}`}
      value={policy}
      onChange={(event) => changePolicy(event.target.value as TerminalPersistencePolicy)}
      onClick={(event) => event.stopPropagation()}
      className="h-4 max-w-[112px] rounded border border-theme-border bg-theme-sidebar px-1 text-[9px] text-theme-dim outline-none hover:text-theme-fg focus:border-theme-accent"
    >
      <option value="close-with-app">Close with OmniTerm</option>
      <option value="keep-running">Keep running</option>
      <option value="recover-after-reboot">Recover after reboot</option>
    </select>
  )
}
