import { create } from 'zustand'

import type { BookmarksPanelProps } from '../components/BookmarksPanel'
import type { SessionsPanelProps } from '../components/SessionsPanel'

import type { ConnectionsPanelProps } from './connections/usePublishConnections'

/**
 * The Sessions, Bookmarks and Connections tool windows are mounted by the workbench, below the app
 * root, while their data lives in the OmniTerm shell. The shell publishes the panels' props here;
 * nothing else writes.
 */
export const useShellPanels = create<{
  sessions: SessionsPanelProps | null
  bookmarks: BookmarksPanelProps | null
  connections: ConnectionsPanelProps | null
}>(() => ({ sessions: null, bookmarks: null, connections: null }))
