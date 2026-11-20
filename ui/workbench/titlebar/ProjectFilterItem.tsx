import { useMemo, useRef, useState } from 'react'

import type { WorkspaceFolder } from '../../domain'

import { BarButton, Icon } from '../../ide/ui'
import styles from '../../ide/workbench/TitleBar.module.css'
import { useSelectedWorkspace } from '../../platform/workspaceStore'
import { comparablePath, useProjectFilterStore } from '../projectFilterStore'

import { TitlePopupList, type PopupEntry } from './TitlePopupList'
import { activeFolders, addFolderToWorkspace, enableAllFolders, removeFolderFromWorkspace, setFolderDisabled } from './workspaceActions'

function folderName(folder: WorkspaceFolder): string {
  if (folder.name) return folder.name
  const normalized = folder.path.replaceAll('\\', '/').replace(/\/+$/, '')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

/** Radio dot of a single-choice row; drawn with the theme's accent so no glyph font is needed. */
function RadioMark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        flex: 'none',
        width: 12,
        height: 12,
        borderRadius: '50%',
        boxSizing: 'border-box',
        border: `1px solid ${on ? 'var(--accent)' : 'var(--fg-muted)'}`,
        background: on ? 'radial-gradient(var(--accent) 38%, transparent 42%)' : 'transparent',
      }}
    />
  )
}

/**
 * "All projects â–¾": which of the workspace's folders the Project panel shows. The selection is
 * per workspace and resets to all projects whenever the workspace changes.
 */
export function ProjectFilterItem() {
  const workspace = useSelectedWorkspace()
  const filter = useProjectFilterStore((s) => s.filter)
  const setFilter = useProjectFilterStore((s) => s.setFilter)
  const defaultPath = useProjectFilterStore((s) => (workspace ? s.defaults[workspace.id] : undefined))
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const allFolders = workspace?.folders ?? []
  // Only folders that are switched on are part of the project the panel shows.
  const folders = activeFolders(workspace)
  const disabledCount = allFolders.length - folders.length
  const selected = filter === 'all' ? null : folders.find((folder) => folder.path === filter)

  const defaultIndex = defaultPath
    ? folders.findIndex((folder) => comparablePath(folder.path) === comparablePath(defaultPath))
    : -1
  const isDefault = (_folder: WorkspaceFolder, index: number) => index === Math.max(defaultIndex, 0)

  const entries = useMemo<PopupEntry[]>(
    () => [
      {
        id: 'filter:all',
        label: 'All projects',
        detail: String(folders.length),
        lead: <RadioMark on={!selected} />,
        run: () => setFilter('all'),
      },
      ...folders.map((folder, index) => ({
        id: `filter:${folder.id || folder.path}`,
        label: folderName(folder),
        // New terminals and agents start in the default project; picking a project makes it that.
        detail: isDefault(folder, index) ? `${folder.path} · default` : folder.path,
        lead: <RadioMark on={selected?.path === folder.path} />,
        run: () => setFilter(folder.path),
      })),
      {
        id: 'add-folder',
        label: 'Add project folder to workspace…',
        icon: 'plus',
        header: '',
        run: () => workspace && void addFolderToWorkspace(workspace.id),
      },
      // One row per project: the list above only picks what the panel shows.
      // Switch a project off for now instead of removing it: search, scans and the Project panel skip it.
      ...allFolders.map((folder, index) => ({
        id: `toggle:${folder.id || folder.path}`,
        label: `${folder.disabled ? 'Enable' : 'Disable'} ${folderName(folder)}`,
        detail: folder.disabled ? 'disabled for now' : undefined,
        icon: folder.disabled ? 'check' : 'hide',
        ...(index === 0 ? { header: 'Disable for now (kept in the workspace)' } : {}),
        run: () => workspace && void setFolderDisabled(workspace.id, folder, !folder.disabled),
      })),
      ...(workspace && disabledCount > 0
        ? [{ id: 'enable-all', label: 'Enable all projects', icon: 'check', run: () => void enableAllFolders(workspace) }]
        : []),
      ...folders.map((folder, index) => ({
        id: `remove:${folder.id || folder.path}`,
        label: `Remove ${folderName(folder)} from workspace`,
        icon: 'close',
        ...(index === 0 ? { header: '' } : {}),
        run: () => workspace && void removeFolderFromWorkspace(workspace.id, folder),
      })),
    ],
    [folders, allFolders, disabledCount, selected, setFilter, workspace, defaultPath],
  )

  if (!workspace || allFolders.length === 0) return null
  return (
    <>
      <BarButton
        ref={ref}
        variant="title"
        className={styles.widget}
        tooltip="Choose which project of the workspace the Project panel shows"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-testid="project-filter"
      >
        <Icon name="folder" size={16} />
        <span className={styles.widgetText}>{selected ? folderName(selected) : 'All projects'}</span>
        {!selected && (
          <span data-title-count style={{ color: 'var(--fg-subtle)', fontWeight: 400 }}>
            {disabledCount > 0 ? `${folders.length}/${allFolders.length}` : folders.length}
          </span>
        )}
        <Icon name="chevron-down" size={12} className={styles.chevron} />
      </BarButton>
      {open && (
        <TitlePopupList
          anchor={ref}
          onClose={() => setOpen(false)}
          label="Project filter"
          caption={`Show in Project panel (workspace ${workspace.name})`}
          entries={entries}
        />
      )}
    </>
  )
}
