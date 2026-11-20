import type { KeyboardEvent } from 'react'

import type { Workspace } from '../../domain'
import { Icon, Select, showContextMenu } from '../../ide/ui'
import type { EmptyPaneProps } from '../../ide/workbench/contributions'
import { scopedWorkspaceId, selectedWorkspaceId, useWorkspaceStore } from '../../platform/workspaceStore'
import { recordAgentLaunch } from '../../utils/recentAgentLaunches'
import { QUICK_START_AGENTS, type QuickStartAgent, type QuickStartProject } from '../../utils/sessionQuickStart'
import { useClaudeProfiles } from '../../utils/useClaudeProfiles'
import { useShellPanels } from '../shellPanelsStore'

import { focusPickerPane } from './paneQuickStartStore'
import { quickStartAgentIconName } from './sessionIcons'
import { useQuickStartProject } from './useQuickStartProject'

type StartSession = (project: QuickStartProject | null, command: string | null) => void

interface LauncherProps {
  paneId: string
  workspaces: readonly Workspace[]
  workspaceId: string | null
  onStart: StartSession
}

/** The plain terminal leads as the default; the agents follow in the quick start's order. */
const CHOICES: readonly QuickStartAgent[] = [
  ...QUICK_START_AGENTS.filter((agent) => !agent.command),
  ...QUICK_START_AGENTS.filter((agent) => agent.command),
]

const CHOICE = '[data-session-choice]'

/** Up and Down move between the session choices, Home and End jump to the ends. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>): void {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(event.key)) return
  const choices = [...event.currentTarget.querySelectorAll<HTMLElement>(CHOICE)]
  const index = choices.findIndex((choice) => choice === document.activeElement)
  const last = choices.length - 1
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? last
      : event.key === 'ArrowDown' ? (index + 1) % choices.length
        : (index <= 0 ? last : index - 1)
  event.preventDefault()
  choices[next]?.focus()
}

function Launcher({ paneId, workspaces, workspaceId, onStart }: LauncherProps) {
  const { projects, project, choose } = useQuickStartProject(workspaces, workspaceId)
  const claudeProfiles = useClaudeProfiles()
  const start = (command: string | null) => {
    if (command && project) recordAgentLaunch(command, project.cwd)
    // The pane may have lost the focus since; the new tab must still open in it.
    focusPickerPane(paneId)
    onStart(project, command)
  }
  const choiceClass = 'flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 text-left text-[var(--fg)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]'
  return (
    <section
      aria-label="Start a session in this pane"
      className="flex w-[min(320px,100%)] flex-col gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-popup)] p-3 text-left text-[var(--fg)]"
      data-feature="p2.sessions.emptyPane"
    >
      <div className="text-[13px] font-semibold">New session</div>
      <div className="flex flex-col gap-1 text-[11.5px] text-[var(--fg-muted)]">
        <span>Project</span>
        {projects.length === 0
          ? <span className="text-[var(--fg)]">No project folders: it starts in the default folder</span>
          : (
            <Select
              aria-label="Project"
              value={project?.key ?? null}
              options={projects.map((item) => ({ value: item.key, label: item.label, detail: item.cwd, icon: 'folder', verbatim: true }))}
              onChange={choose}
              searchable={projects.length > 8}
            />
          )}
      </div>
      <div className="text-[11.5px] text-[var(--fg-muted)]">Session</div>
      <div role="group" aria-label="Session" className="flex flex-col gap-0.5" onKeyDown={moveFocus}>
        {CHOICES.map((agent) => {
          const isDefault = !agent.command
          const icon = quickStartAgentIconName(agent)
          return (
            <div key={agent.id} className={`flex items-center rounded-md${isDefault ? ' border border-[var(--accent)]' : ' border border-transparent'}`}>
              <button
                type="button"
                data-session-choice
                aria-label={isDefault ? `${agent.label} (default)` : agent.label}
                className={choiceClass}
                onClick={() => start(agent.command)}
              >
                <span data-icon={icon} className="flex flex-none">
                  <Icon name={icon} size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate">{agent.label}</span>
                {isDefault && <span className="flex-none text-[11px] text-[var(--fg-muted)]">default</span>}
              </button>
              {agent.id === 'claude' && claudeProfiles.length > 1 && (
                <button
                  type="button"
                  aria-label="Claude profiles"
                  aria-haspopup="menu"
                  className="flex h-[30px] w-[26px] flex-none items-center justify-center rounded-md text-[var(--fg-muted)] hover:bg-[var(--bg-hover)]"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    showContextMenu({ x: rect.left, y: rect.bottom }, claudeProfiles.map((choice) => ({
                      label: choice.label,
                      verbatim: true,
                      run: () => start(choice.command),
                    })))
                  }}
                >
                  <Icon name="chevron-down" size={14} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * The launcher of an empty pane, OmniTerm's way: the project from a dropdown, then the plain
 * terminal (the default) or one of the agents, started in this pane.
 */
export function EmptyPaneLauncher({ paneId }: EmptyPaneProps) {
  const sessions = useShellPanels((s) => s.sessions)
  const scopeWorkspaceId = useWorkspaceStore(scopedWorkspaceId)
  const currentWorkspaceId = useWorkspaceStore((state) => selectedWorkspaceId(state.selection))
  if (!sessions) return <div>Empty pane</div>
  return (
    <Launcher
      paneId={paneId}
      workspaces={sessions.workspaces}
      workspaceId={scopeWorkspaceId ?? currentWorkspaceId}
      onStart={sessions.onStart}
    />
  )
}
