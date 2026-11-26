import { useEffect } from 'react'

import { useShellPanels } from '../workbench/shellPanelsStore'

import type { BookmarksPanelProps } from './BookmarksPanel'
import type { SessionsPanelProps } from './SessionsPanel'

/** Hands the Sessions and Bookmarks panel props to the workbench tool windows that show them. */
export function usePublishShellPanels(
  enabled: boolean,
  sessions: SessionsPanelProps,
  bookmarks: BookmarksPanelProps,
): void {
  useEffect(() => {
    if (!enabled) return undefined
    useShellPanels.setState({ sessions, bookmarks })
    return () => useShellPanels.setState({ sessions: null, bookmarks: null })
  })
}
