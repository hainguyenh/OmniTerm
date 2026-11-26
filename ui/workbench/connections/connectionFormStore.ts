import { create } from 'zustand'

import type { ConnectionDraft } from './connectionDraft'

/** An open New / Edit connection form: what it starts from and which workspace it saves into. */
export interface ConnectionFormRequest {
  draft: ConnectionDraft
  /** Null: the form asks (no workspace is in scope). */
  workspaceId: string | null
  /** Editing keeps the profile in its workspace. */
  editing: boolean
  /** Bumped on every open, so a reopened form starts from its own draft. */
  seq: number
}

export const useConnectionForm = create<{ request: ConnectionFormRequest | null }>(() => ({ request: null }))

let seq = 0

export function openConnectionForm(draft: ConnectionDraft, workspaceId: string | null, editing = false): void {
  useConnectionForm.setState({ request: { draft, workspaceId, editing, seq: ++seq } })
}

export function closeConnectionForm(): void {
  useConnectionForm.setState({ request: null })
}
