import { useEffect, useMemo, useState } from 'react'

import type { Workspace } from '@omniterm/contract'

import { ProjectBadge } from '../../ide/features/welcome/RecentList'
import { promptInput } from '../../ide/workbench/inputDialogs'
import type { ProjectPopupProps } from '../../ide/workbench/contributions'
import { selectedWorkspaceId, useWorkspaceStore } from '../../platform/workspaceStore'

import { TitlePopupList, type PopupEntry } from './TitlePopupList'
import { addFolderToWorkspace, addWorkspaceFromFolder, createWorkspace, importWorkspaceFile } from './workspaceActions'

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

/** Connection counts per workspace, read once when the popup opens. */
function useConnectionCounts(workspaces: readonly Workspace[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    let live = true
    for (const workspace of workspaces) {
      void window.omnitermAPI.workspace.loadConnections(workspace.id).then(
        (connections) => live && setCounts((previous) => ({ ...previous, [workspace.id]: connections.length })),
        () => undefined,
      )
    }
    return () => {
      live = false
    }
  }, [workspaces])
  return counts
}

/**
 * The title bar project widget's popup. In OmniTerm the "project" is the workspace (a named set of
 * folders and connections), so it lists workspaces and switches the one shared selection.
 */
export function WorkspacePopup({ anchor, onClose }: ProjectPopupProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const currentId = useWorkspaceStore((s) => selectedWorkspaceId(s.selection))
  const selectWorkspace = useWorkspaceStore((s) => s.selectWorkspace)
  const allScope = useWorkspaceStore((s) => s.scope === 'all')
  const setScope = useWorkspaceStore((s) => s.setScope)
  const refresh = useWorkspaceStore((s) => s.refresh)
  const counts = useConnectionCounts(workspaces)
  useEffect(() => void refresh(), [refresh])

  const entries = useMemo<PopupEntry[]>(() => {
    const rows: PopupEntry[] = workspaces.map((workspace, index) => ({
      id: `workspace:${workspace.id}`,
      label: workspace.name,
      detail: [plural(workspace.folders?.length ?? 0, 'project'), counts[workspace.id] === undefined ? null : plural(counts[workspace.id], 'connection')]
        .filter(Boolean)
        .join(' · '),
      lead: <ProjectBadge name={workspace.name} />,
      checked: !allScope && workspace.id === currentId,
      header: index === 0 ? 'Workspaces' : undefined,
      run: () => selectWorkspace(workspace.id),
    }))
    // Sessions and Connections of every workspace, split per workspace; the project tree stays on
    // the selected one.
    if (workspaces.length > 1) {
      rows.unshift({
        id: 'all-workspaces',
        label: 'All workspaces',
        detail: 'Sessions and connections of every workspace',
        icon: 'list',
        checked: allScope,
        header: 'Workspaces',
        run: () => setScope('all'),
      })
      rows[1] = { ...rows[1], header: undefined }
    }
    rows.push(
      {
        id: 'new',
        label: 'New workspace…',
        icon: 'plus',
        header: '',
        run: () => void promptInput({ title: 'New Workspace', label: 'Workspace name:', okLabel: 'Create' }).then((name) => (name ? createWorkspace(name) : undefined)),
      },
      { id: 'add-folder', label: 'Add folder to workspace…', icon: 'folder', run: () => currentId && void addFolderToWorkspace(currentId) },
      { id: 'add-workspace', label: 'Open folder as workspace…', icon: 'folder-open', run: () => void addWorkspaceFromFolder() },
      { id: 'import', label: 'Import VS Code workspace…', icon: 'download', run: () => void importWorkspaceFile() },
    )
    return rows
  }, [workspaces, counts, currentId, selectWorkspace, allScope, setScope])

  return <TitlePopupList anchor={anchor} onClose={onClose} label="Workspaces" entries={entries} />
}
