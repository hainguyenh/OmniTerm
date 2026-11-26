import { Button, Tabs, type TabItem } from '../../ide/ui'
import { useSessionCleanup } from '../sessions/sessionCleanupStore'
import { useTempCleanup } from '../tempCleanup/tempCleanupStore'

import { useCleanUpView, type CleanUpTab } from './cleanUpViewStore'
import { RustCleanupPanel } from './RustCleanupPanel'
import { TestDataCleanupPanel } from './TestDataCleanupPanel'
import { WorktreeCleanupPanel } from './WorktreeCleanupPanel'

const TABS: TabItem[] = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'temp', label: 'Temp' },
  { id: 'rust', label: 'Rust' },
  { id: 'worktrees', label: 'Worktrees' },
  { id: 'test-data', label: 'Test Data' },
]

const isTab = (id: string): id is CleanUpTab => TABS.some((tab) => tab.id === id)

/** A clean-up that has its own dialog: what it does, its last result, and the button opening it. */
function DialogLauncher({ title, description, status, busy, onOpen, testId }: {
  title: string
  description: string
  status: string | null
  busy: boolean
  onOpen: () => void
  testId: string
}) {
  return (
    <div className="flex flex-col items-start gap-2 p-3 text-[12px]" data-testid={testId}>
      <p className="text-[var(--fg-muted)]">{description}</p>
      {busy && <p>Running in the background; see Background Tasks in the status bar.</p>}
      {status && !busy && <p className="text-[var(--fg-muted)]">{`Last run: ${status}`}</p>}
      <Button variant="primary" size="small" icon="broom" onClick={onOpen}>
        {title}
      </Button>
    </div>
  )
}

function SessionsTab() {
  const status = useSessionCleanup((s) => s.status)
  const busy = useSessionCleanup((s) => s.job !== null)
  return (
    <DialogLauncher
      title="Clean Up Old Sessions…"
      description="AI agent conversations on disk and the sessions OmniTerm remembers, by agent and profile, oldest first. Sessions open in a pane are never deleted."
      status={status}
      busy={busy}
      onOpen={() => useSessionCleanup.getState().setOpen(true)}
      testId="cleanup-sessions-tab"
    />
  )
}

function TempTab() {
  const status = useTempCleanup((s) => s.status)
  const busy = useTempCleanup((s) => s.job !== null)
  return (
    <DialogLauncher
      title="Clean Temp Files…"
      description="What AI agents and build tools leave in the system temp folder, grouped by kind with sizes. Only entries idle for the chosen time are deleted."
      status={status}
      busy={busy}
      onOpen={() => useTempCleanup.getState().setOpen(true)}
      testId="cleanup-temp-tab"
    />
  )
}

/**
 * The Clean Up tool window: one tab per kind of clean-up. Sessions and Temp open their dialogs;
 * Rust (Cargo build folders), Worktrees (git worktrees) and Test Data (folders OmniTerm's test runs
 * left in the app-data folders) work right in the tab.
 */
export function CleanUpToolWindow() {
  const tab = useCleanUpView((s) => s.tab)
  const setTab = useCleanUpView((s) => s.setTab)
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="cleanup-tool-window">
      <Tabs
        items={TABS}
        activeId={tab}
        onSelect={(id) => isTab(id) && setTab(id)}
        variant="compact"
        aria-label="Clean up"
        panelIdPrefix="cleanup-tab"
      />
      <div className="min-h-0 flex-1" role="tabpanel" id={`cleanup-tab-${tab}`}>
        {tab === 'sessions' && <SessionsTab />}
        {tab === 'temp' && <TempTab />}
        {tab === 'rust' && <RustCleanupPanel />}
        {tab === 'worktrees' && <WorktreeCleanupPanel />}
        {tab === 'test-data' && <TestDataCleanupPanel />}
      </div>
    </div>
  )
}
