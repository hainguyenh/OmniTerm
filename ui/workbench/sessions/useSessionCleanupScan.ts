import { useEffect, useState } from 'react'

import { listSessionProfiles, type SessionProfile } from './sessionCleanupModel'

/** The agent profile folders on this machine, read once when the dialog opens (folder names only). */
export function useSessionProfiles(): SessionProfile[] | null {
  const [profiles, setProfiles] = useState<SessionProfile[] | null>(null)
  useEffect(() => {
    let live = true
    listSessionProfiles().then(
      (found) => {
        if (live) setProfiles(found)
      },
      () => {
        if (live) setProfiles([])
      },
    )
    return () => {
      live = false
    }
  }, [])
  return profiles
}
