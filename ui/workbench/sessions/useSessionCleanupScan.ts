import { useCallback, useEffect, useRef, useState } from 'react'

import { listSessionFiles, listSessionProfiles, type AgentSessionFile, type SessionProfile } from './sessionCleanupModel'

/** How long a scan of the agents' local session folders may take before the dialog gives up on it. */
const SCAN_TIMEOUT_MS = 30_000

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

/**
 * The conversations of the profiles last scanned. Nothing is read until the user presses Scan:
 * `files` stays null until then. A scan that outlives the timeout is reported and its late answer
 * dropped; `rescan` reads the same profiles again (after a delete).
 */
export function useSessionScan() {
  const [files, setFiles] = useState<AgentSessionFile[] | null>(null)
  const [scanned, setScanned] = useState<readonly string[]>([])
  const [scannedDays, setScannedDays] = useState(0)
  const lastDays = useRef(0)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const scan = useCallback(async (profiles: readonly string[], olderThanDays = 0) => {
    const current = ++generation.current
    setScanning(true)
    setError(null)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('the scan took too long. Scan again, or narrow it to fewer profiles')), SCAN_TIMEOUT_MS)
    })
    try {
      const listed = await Promise.race([listSessionFiles(profiles, olderThanDays), timeout])
      if (current !== generation.current) return
      setFiles(listed)
      setScanned(profiles)
      setScannedDays(olderThanDays)
      lastDays.current = olderThanDays
    } catch (cause) {
      if (current !== generation.current) return
      setFiles([])
      setScanned(profiles)
      setScannedDays(olderThanDays)
      lastDays.current = olderThanDays
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      clearTimeout(timer)
      if (current === generation.current) setScanning(false)
    }
  }, [])
  return { files, scanned, scannedDays, scanning, error, scan, rescan: () => scan(scanned, lastDays.current) }
}
