import { describe, expect, it } from 'vitest'
import { buildWorkspacePanelView, collectDirKeys } from '../workspacePanelView'
import { DEFAULT_TREE_FILTER } from '../../utils/workspaceFilter'
import { dir, file } from './workspacePanelTestUtils'

const entries = [
  dir('empty'),
  dir('tools'),
  dir('tools/nested'),
  file('tools/deploy.ps1', 'ps1', 'powershell'),
  file('tools/notes.txt', 'txt'),
]

describe('workspace panel view model', () => {
  it('keeps folders that own connections even when the default script filter empties them', () => {
    const view = buildWorkspacePanelView({
      workspaceId: 'ws',
      entries,
      pins: [],
      connections: [{
        id: 'connection-1',
        name: 'Empty-folder host',
        type: 'SSH',
        host: 'example.com',
        port: '22',
        user: 'ops',
        parentId: 'empty',
      }],
      filesByFolder: { tools: [entries[3], entries[4]] },
      filter: DEFAULT_TREE_FILTER,
      query: '',
      expandedDirs: new Set(),
    })

    expect(view.tree.map((node) => node.path)).toEqual(['empty', 'tools'])
    expect(view.files.map((entry) => entry.id)).toEqual(['tools/deploy.ps1'])
  })

  it('keeps unloaded and expanded folders for whole-tree filters', () => {
    const view = buildWorkspacePanelView({
      workspaceId: 'ws',
      entries,
      pins: [],
      connections: [],
      filesByFolder: {},
      filter: { mode: 'all', kinds: [], paths: [], showEmptyDirs: false },
      query: '',
      expandedDirs: new Set(['ws:tools/nested', 'other:ignored']),
    })

    expect(view.tree.map((node) => node.path)).toEqual(['empty', 'tools'])
    expect(collectDirKeys('ws', view.tree)).toEqual(['ws:empty', 'ws:tools', 'ws:tools/nested'])
  })

  it('builds parent-aware folder options and filters the tree by query', () => {
    const view = buildWorkspacePanelView({
      workspaceId: 'ws',
      entries,
      pins: [],
      connections: [],
      filesByFolder: { tools: [entries[3], entries[4]] },
      filter: { mode: 'all', kinds: [], paths: [], showEmptyDirs: true },
      query: 'notes',
      expandedDirs: new Set(),
    })

    expect(view.folders).toEqual([
      { id: 'empty', name: 'empty', parentId: undefined },
      { id: 'tools', name: 'tools', parentId: undefined },
      { id: 'tools/nested', name: 'nested', parentId: 'tools' },
    ])
    expect(view.tree).toHaveLength(1)
    expect(view.tree[0].path).toBe('tools')
    expect(view.tree[0].children.map((node) => node.path)).toContain('tools/notes.txt')
  })

  it('lets a root folder override the workspace filter', () => {
    const view = buildWorkspacePanelView({
      workspaceId: 'ws',
      entries,
      pins: [],
      connections: [],
      rootFolders: [{ id: 'tools', name: 'tools' }],
      filesByFolder: { tools: [entries[3], entries[4]] },
      filter: DEFAULT_TREE_FILTER,
      folderFilters: {
        tools: { mode: 'all', kinds: [], paths: [], showEmptyDirs: false },
      },
      query: '',
      expandedDirs: new Set(),
    })

    const tools = view.tree.find((node) => node.path === 'tools')
    expect(tools?.children.map((node) => node.path)).toContain('tools/notes.txt')
  })
})
