/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Workspace, WorkspaceEntry } from '@omniterm/contract'
import WorkspaceTreeRenderer from '../WorkspaceTreeRenderer'
import { DEFAULT_TREE_FILTER } from '../../utils/workspaceFilter'
import type { WorkspacePanelView } from '../workspacePanelView'

const workspace: Workspace = {
  id: 'w1',
  name: 'Dev',
  folders: [{ id: 'root', name: 'root', path: 'F:/root' }],
  order: 0,
  pins: [],
}

const folder: WorkspaceEntry = {
  id: 'root', name: 'root', path: 'F:/root', isDir: true, kind: 'dir',
}
const file: WorkspaceEntry = {
  id: 'root/readme.txt', name: 'readme.txt', path: 'F:/root/readme.txt', isDir: false, kind: 'txt', viewable: true,
}
const view: WorkspacePanelView = {
  tree: [{
    name: 'root', path: 'root', isDir: true, entry: folder,
    children: [{ name: 'readme.txt', path: 'root/readme.txt', isDir: false, entry: file, openable: { id: file.id, name: file.name, path: file.path, kind: file.kind, editable: false, viewable: true }, children: [] }],
  }],
  folders: [{ id: 'root', name: 'root' }],
  files: [file],
}

const noop = vi.fn()

function renderTree() {
  return render(
    <WorkspaceTreeRenderer
      workspace={workspace}
      view={view}
      entries={[folder, file]}
      connections={[]}
      query=""
      flatView={false}
      filter={{ ...DEFAULT_TREE_FILTER, mode: 'all' }}
      folderFilters={{}}
      expandedDirs={new Set(['w1:root'])}
      loadingFolders={new Set()}
      scanning={false}
      loadingAll={false}
      pageInfo={{}}
      filesByFolder={{ root: [file] }}
      loadingMore={null}
      isPinned={() => false}
      onTogglePinned={noop}
      onToggleDir={noop}
      onLoadMore={noop}
      onOpenScript={noop}
      onRunScript={noop}
      onOpenTerminal={noop}
      onSetFolderPendingRemoval={noop}
      onOpenFolderFilterMenu={noop}
      renderConnectionAction={() => null}
      onDeleteWorkspaceConnection={noop}
      isHighlighted={() => false}
      registerRow={() => () => {}}
    />,
  )
}

describe('WorkspaceTreeRenderer backgrounds', () => {
  it('keeps normal folder and file rows transparent while preserving hover styling', () => {
    renderTree()
    const folderRow = screen.getByText('root').closest('.group') as HTMLElement
    const fileRow = screen.getByText('readme.txt').closest('.group') as HTMLElement

    expect(folderRow.className).not.toContain('bg-[var(--theme-bg)]')
    expect(fileRow.className).not.toContain('bg-[var(--theme-bg)]')
    expect(folderRow.className).toContain('hover:bg-[var(--theme-hover-bg)]')
    expect(fileRow.className).toContain('hover:bg-[var(--theme-hover-bg)]')
  })
})
