import { invoke } from '@tauri-apps/api/core'

export interface TempNoteMeta {
  id: string
  title: string
  mtime_ms: number
  size: number
}

export function createTempNotesAPI() {
  return {
    list: () => invoke<TempNoteMeta[]>('list_temp_notes'),
    read: (id: string) => invoke<string>('read_temp_note', { id }),
    write: (id: string, content: string) => invoke<TempNoteMeta>('write_temp_note', { id, content }),
    delete: (id: string) => invoke<boolean>('delete_temp_note', { id }),
    saveAs: (id: string, suggestedName?: string) =>
      invoke<string | null>('save_temp_note_as', { id, suggestedName: suggestedName ?? null }),
  }
}

export type TempNotesAPI = ReturnType<typeof createTempNotesAPI>
