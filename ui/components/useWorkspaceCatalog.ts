import { useCallback, useState, useEffect } from 'react'

import { useWorkspaceStore } from '../platform/workspaceStore'

/**
 * Workspace catalog plus live shell working directories.
 *
 * The catalog and the selected workspace live in the shared workspace store, so the title bar and
 * this layout always agree on them. The cwd map is the OSC-fed "where is this shell now" signal
 * that pane headers render in real time.
 */
export function useWorkspaceCatalog() {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const setWorkspaces = useWorkspaceStore((s) => s.setWorkspaces)
  const selectedWorkspaceId = useWorkspaceStore((s) => s.selection)
  const setSelectedWorkspaceId = useWorkspaceStore((s) => s.setSelection)
  const refreshWorkspaces = useWorkspaceStore((s) => s.refresh)
  // Live shell working directories (OSC 7 / OSC 9;9), keyed by session id.
  const [sessionCwds, setSessionCwds] = useState<Record<string, string>>({})
  const [homeDir, setHomeDir] = useState('')
  const setSessionCwd = useCallback((id: string, cwd: string) => {
      setSessionCwds(prev => (prev[id] === cwd ? prev : { ...prev, [id]: cwd }))
  }, [])
  useEffect(() => { void refreshWorkspaces() }, [refreshWorkspaces])
  useEffect(() => {
    const getHomeDir = window.omnitermAPI?.files?.getHomeDir
    if (!getHomeDir) return
    void getHomeDir().then(setHomeDir).catch(() => setHomeDir(''))
  }, [])
  return { workspaces, setWorkspaces, selectedWorkspaceId, setSelectedWorkspaceId, refreshWorkspaces, sessionCwds, setSessionCwd, homeDir }
}
