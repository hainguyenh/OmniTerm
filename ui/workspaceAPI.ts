import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { Connection, Workspace, WorkspaceScript } from '@omniterm/contract'

type WorkspaceWire = Omit<Workspace, 'pins'> & { pins?: Workspace['pins'] }

/** Normalize versioned/persisted workspace payloads at the Tauri boundary. */
function normalizeWorkspace(workspace: WorkspaceWire): Workspace {
  return { ...workspace, pins: workspace.pins ?? [] }
}

function normalizeWorkspaces(workspaces: WorkspaceWire[]): Workspace[] {
  return workspaces.map(normalizeWorkspace)
}

/** Thin renderer adapter for composite-workspace commands and file pickers. */
export function createWorkspaceAPI() {
  return {
    list: () => invoke<WorkspaceWire[]>('list_workspaces').then(normalizeWorkspaces),
    create: (name: string) => invoke<WorkspaceWire>('create_workspace', { name }).then(normalizeWorkspace),
    add: async () => {
      const path = await open({ directory: true, multiple: false })
      return typeof path === 'string'
        ? invoke<WorkspaceWire>('add_workspace', { path }).then(normalizeWorkspace)
        : null
    },
    addFolder: async (workspaceId: string) => {
      const path = await open({ directory: true, multiple: false })
      return typeof path === 'string'
        ? invoke<WorkspaceWire>('add_workspace_folder', { workspaceId, path }).then(normalizeWorkspace)
        : null
    },
    importFile: async () => {
      const path = await open({
        multiple: false,
        filters: [{ name: 'VS Code workspace', extensions: ['code-workspace', 'workspace'] }],
      })
      return typeof path === 'string'
        ? invoke<WorkspaceWire>('import_workspace_file', { path }).then(normalizeWorkspace)
        : null
    },
    remove: (id: string) => invoke<void>('remove_workspace', { id }),
    rename: (workspaceId: string, name: string) =>
      invoke<WorkspaceWire>('rename_workspace', { workspaceId, name }).then(normalizeWorkspace),
    move: (workspaceId: string, parentId: string | null, index: number) =>
      invoke<WorkspaceWire[]>('move_workspace', { workspaceId, parentId, index }).then(normalizeWorkspaces),
    setPinned: (workspaceId: string, folderId: string, path: string, pinned: boolean) =>
      invoke<WorkspaceWire>('set_workspace_entry_pinned', { workspaceId, folderId, path, pinned }).then(normalizeWorkspace),
    scanScripts: (workspaceId: string) => invoke('scan_scripts', { workspaceId }),
    // Folder skeleton first; files remain lazily paged per logical folder path.
    scanFolders: (workspaceId: string) => invoke('scan_workspace_folders', { workspaceId }),
    scanFolderEntries: (workspaceId: string, folder = '', offset = 0, limit = 2000) =>
      invoke('scan_workspace_entries', { workspaceId, folder, offset, limit }),
    run: (payload: { workspaceId: string; script?: WorkspaceScript; subPath?: string }) =>
      invoke<boolean>('run_script', {
        workspaceId: payload.workspaceId,
        script: payload.script ?? null,
        subPath: payload.subPath ?? null,
      }),
    readScript: (workspaceId: string, path: string) => invoke<string>('read_script', { workspaceId, path }),
    writeScript: (workspaceId: string, path: string, content: string) =>
      invoke<void>('write_script', { workspaceId, path, content }),
    loadConnections: (workspaceId: string) =>
      invoke<Connection[]>('load_workspace_connections', { workspaceId }).catch(() => []),
    saveConnections: (workspaceId: string, data: Connection[]) =>
      invoke<void>('save_workspace_connections', { workspaceId, data }),
    deleteConnection: (workspaceId: string, connectionId: string) =>
      invoke<void>('delete_workspace_connection', { workspaceId, connectionId }),
  }
}
