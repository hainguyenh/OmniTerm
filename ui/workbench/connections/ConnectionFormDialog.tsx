import { useState, type ReactNode } from 'react'

import { Checkbox, Dialog, Input, Radio, Select } from '../../ide/ui'
import { useWorkspaceStore } from '../../platform/workspaceStore'

import { useShellPanels } from '../shellPanelsStore'
import { connectionFromDraft, draftProblem, type ConnectionDraft, type RemoteType } from './connectionDraft'
import { closeConnectionForm, useConnectionForm, type ConnectionFormRequest } from './connectionFormStore'

const DEFAULT_PORT: Record<RemoteType, string> = { SSH: '22', RDP: '3389' }

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[7rem_1fr] items-center gap-2">
      <span className="text-[var(--fg-muted)]">{label}</span>
      {children}
    </label>
  )
}

function ConnectionForm({ request }: { request: ConnectionFormRequest }) {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const refresh = useShellPanels((s) => s.connections?.onRefresh)
  const [draft, setDraft] = useState<ConnectionDraft>(request.draft)
  const [workspaceId, setWorkspaceId] = useState<string | null>(request.workspaceId ?? workspaces[0]?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<ConnectionDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setError(null)
  }
  const problem = draftProblem(draft) ?? (workspaceId ? null : 'Choose the workspace to save into.')

  const save = async () => {
    if (problem || !workspaceId) {
      setError(problem)
      return
    }
    setSaving(true)
    try {
      await window.omnitermAPI.workspace.saveConnection(workspaceId, connectionFromDraft(draft))
      await refresh?.()
      closeConnectionForm()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const title = request.editing
    ? 'Edit Connection'
    : draft.type === 'SSH' ? 'New SSH Connection' : 'New Remote Desktop Connection'
  return (
    <Dialog
      open
      onClose={closeConnectionForm}
      title={title}
      width={460}
      keepInside
      buttons={[
        { label: 'Save', role: 'default', disabled: saving, onClick: () => void save() },
        { label: 'Cancel', role: 'cancel' },
      ]}
      footerStart={error && <span className="text-[var(--danger)]" role="alert">{error}</span>}
    >
      <form
        className="flex flex-col gap-2.5 px-4 pb-1 pt-3"
        data-testid="connection-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {!request.editing && (
          <Field label="Type">
            <span className="flex gap-4">
              <Radio name="connection-type" label="SSH" checked={draft.type === 'SSH'} onChange={() => set({ type: 'SSH' })} />
              <Radio name="connection-type" label="Remote Desktop" checked={draft.type === 'RDP'} onChange={() => set({ type: 'RDP' })} />
            </span>
          </Field>
        )}
        <Field label="Workspace">
          <Select
            aria-label="Workspace"
            value={workspaceId}
            disabled={request.editing}
            placeholder="Choose a workspace"
            options={workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name, verbatim: true }))}
            onChange={(value) => {
              setWorkspaceId(value)
              setError(null)
            }}
          />
        </Field>
        <Field label="Host">
          <Input aria-label="Host" value={draft.host} placeholder="server.example.com or 10.0.0.5" onChange={(event) => set({ host: event.target.value })} />
        </Field>
        <Field label="Port">
          <Input aria-label="Port" value={draft.port} inputMode="numeric" placeholder={DEFAULT_PORT[draft.type]} onChange={(event) => set({ port: event.target.value })} />
        </Field>
        <Field label="User">
          <Input aria-label="User" value={draft.user} placeholder="optional" onChange={(event) => set({ user: event.target.value })} />
        </Field>
        <Field label="Name">
          <Input aria-label="Name" value={draft.name} placeholder="defaults to user@host" onChange={(event) => set({ name: event.target.value })} />
        </Field>
        {draft.type === 'RDP' && (
          <Field label="">
            <Checkbox label="Share local drives with the remote desktop" checked={draft.redirectDrives} onChange={(redirectDrives) => set({ redirectDrives })} />
          </Field>
        )}
        <p className="text-[11px] text-[var(--fg-muted)]">
          Passwords are never saved: type it when the server asks. Saved to the workspace&apos;s .omniterm/connections.json.
        </p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

/** The New / Edit connection form, while one is open. */
export function ConnectionFormDialog() {
  const request = useConnectionForm((s) => s.request)
  return request ? <ConnectionForm key={request.seq} request={request} /> : null
}
