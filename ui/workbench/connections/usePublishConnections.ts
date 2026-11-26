import { useEffect } from 'react'

import { diag } from '../../diag'
import type { Connection } from '../../domain'

import { useShellPanels } from '../shellPanelsStore'
import { loadSavedConnections } from './loadSavedConnections'

/** What the Connections tool window shows and does; the OmniTerm shell owns both. */
export interface ConnectionsPanelProps {
  connections: readonly Connection[]
  onConnect: (connection: Connection) => void
  onRefresh: () => Promise<void>
}

/** Hands the shell's saved connections and its connect path to the Connections tool window. */
export function usePublishConnections(
  connections: readonly Connection[],
  onConnect: (connection: Connection) => void,
  setConnections: (connections: Connection[]) => void,
): void {
  useEffect(() => {
    const onRefresh = async () => {
      try {
        setConnections(await loadSavedConnections())
      } catch (error) {
        diag.error('[Connections] could not reload workspace connections', error)
      }
    }
    useShellPanels.setState({ connections: { connections, onConnect, onRefresh } })
    return () => useShellPanels.setState({ connections: null })
  })
}
