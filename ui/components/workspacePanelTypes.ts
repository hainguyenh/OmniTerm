import type {
  Connection,
  Folder as ConnectionFolder,
  WorkspaceScript,
} from '@omniterm/contract'
import type { RevealRequest } from '../hooks/useTreeReveal'

export interface WorkspacePanelProps {
  /** Open an item in the app's right-side dock. */
  onOpenScript: (workspaceId: string, script: WorkspaceScript) => void
  /** Launch an item while allowing the host to pair its terminal and editor tabs. */
  onRunScript?: (workspaceId: string, script: WorkspaceScript) => void
  /** Surface a failed launch to the user. */
  showAlert?: (
    message: string,
    opts?: { title?: string; tone?: 'info' | 'warning' | 'error' },
  ) => Promise<void> | void
  /** Connect to a workspace connection. */
  onConnectWorkspaceConnection?: (conn: Connection) => void
  /** False when no connection-provider plugin is active. */
  hasConnectionProvider?: boolean
  /** Open the connection form at a workspace folder. */
  onAddWorkspaceConnection?: (target: WorkspaceConnectionTarget) => void
  /** Open the connection form to edit an existing workspace connection. */
  onEditWorkspaceConnection?: (target: WorkspaceConnectionTarget, conn: Connection) => void
  /** Incremented after a workspace connection is written. */
  connectionsRevision?: number
  /** Request expansion, scrolling, and highlighting for one workspace file. */
  revealRequest?: RevealRequest | null
  /** Notify the main layout so workspace selectors refresh immediately after adding a workspace. */
  onWorkspacesChanged?: () => void | Promise<void>
}

/** Everything the connection form needs to know about where a connection is saved. */
export interface WorkspaceConnectionTarget {
  workspaceId: string
  /** Folder-namespaced logical path; workspace actions always target a real folder/subfolder. */
  parentPath: string
  folders: ConnectionFolder[]
  rootLabel: string
}
