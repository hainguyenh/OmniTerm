import { useCallback, useState, useEffect } from 'react'
import type { Workspace } from '@omniterm/contract'
import { normalizeWorkspaceSelection } from '../utils/workspaceSelection'

/**
 * Workspace catalog plus live shell working directories.
 *
 * The catalog feeds workspace-scoped UI (panel, launch menus, alias lookup);
 * the cwd map is the OSC-fed "where is this shell now" signal that pane
 * headers render in real time.
 */
export function useWorkspaceCatalog() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  // Live shell working directories (OSC 7 / OSC 9;9), keyed by session id.
  const [sessionCwds, setSessionCwds] = useState<Record<string, string>>({})
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(() => {
      try { return localStorage.getItem('omniterm:last-workspace') } catch { return null }
  })
  const refreshWorkspaces = useCallback(async () => {
      await window.omnitermAPI.workspace.list().then(list => {
          setWorkspaces(list)
          setSelectedWorkspaceId(current => normalizeWorkspaceSelection(list, current))
      }).catch(() => setWorkspaces([]))
  }, [])
  const setSessionCwd = useCallback((id: string, cwd: string) => {
      setSessionCwds(prev => (prev[id] === cwd ? prev : { ...prev, [id]: cwd }))
  }, [])
  useEffect(() => { void refreshWorkspaces() }, [refreshWorkspaces])
  return { workspaces, setWorkspaces, selectedWorkspaceId, setSelectedWorkspaceId, refreshWorkspaces, sessionCwds, setSessionCwd }
}
