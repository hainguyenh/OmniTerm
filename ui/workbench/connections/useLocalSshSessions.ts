import { useEffect, useState } from 'react'

/** How often the open Connections tool window looks for `ssh` started in a terminal. */
export const SSH_POLL_MS = 5_000

/** The `ssh` clients running in local terminals, polled while the caller is mounted. */
export function useLocalSshSessions(): readonly LocalSshSession[] {
  const [sessions, setSessions] = useState<readonly LocalSshSession[]>([])
  useEffect(() => {
    const scan = window.omnitermAPI?.connections?.localSshSessions
    if (!scan) return undefined
    let cancelled = false
    const poll = () => {
      void scan().then((next) => {
        if (cancelled) return
        // Keep the previous array while nothing changed, so the tree does not rebuild every poll.
        setSessions((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
      })
    }
    poll()
    const timer = window.setInterval(poll, SSH_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])
  return sessions
}
