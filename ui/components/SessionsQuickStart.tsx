import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Workspace } from '../domain'

import { Icon } from '../ide/ui'
import { QUICK_START_AGENTS, quickStartProjects, type QuickStartProject } from '../utils/sessionQuickStart'
import { defaultProjectAmong } from '../workbench/projectFilterStore'
import { SESSIONS_ICON } from '../workbench/shellIcons'

interface SessionsQuickStartProps {
  workspaces: readonly Workspace[]
  /** `project` is null when the workspace has no folders; the session then opens in the default place. */
  onStart: (project: QuickStartProject | null, command: string | null) => void
  onClose: () => void
  /** The current workspace: only its projects are offered (all workspaces' when it has none). */
  workspaceId?: string | null
  /** Start in this folder: the project list is left out ("Start agent here…" of the Project view). */
  project?: QuickStartProject | null
  /** Adds a project folder to the current workspace (the list's last row). */
  onAddProject?: () => void
  /** Viewport point of the popup's top-left corner; by default below the Sessions header's "+". */
  at?: { x: number; y: number } | null
}

const POPUP_WIDTH = 340
const ADD_BUTTON = '[data-feature="p2.sessions.addProject"]'

/** Below the Sessions header's "+" button (or `at`), kept inside the window. */
function popupPosition(at: { x: number; y: number } | null | undefined): { left: number; top: number } {
  const anchor = at ?? (() => {
    const rect = document.querySelector(ADD_BUTTON)?.getBoundingClientRect()
    return rect ? { x: rect.left - 10, y: rect.bottom + 4 } : { x: 48, y: 72 }
  })()
  return {
    left: Math.max(4, Math.min(anchor.x, window.innerWidth - POPUP_WIDTH - 4)),
    top: Math.max(4, anchor.y),
  }
}

/** Radio dot of the project list, drawn with the theme's accent. */
function RadioMark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className="h-3 w-3 flex-none rounded-full border"
      style={{
        borderColor: on ? 'var(--accent)' : 'var(--fg-muted)',
        background: on ? 'radial-gradient(var(--accent) 38%, transparent 42%)' : 'transparent',
      }}
    />
  )
}

/**
 * Popup of the Sessions header's "+" (and of "Start agent here…"): pick a project of the workspace,
 * then the agent or the plain terminal to start in it.
 */
export const SessionsQuickStart: React.FC<SessionsQuickStartProps> = ({
  workspaces, onStart, onClose, workspaceId, project: fixedProject, onAddProject, at,
}) => {
  const projects = useMemo(() => {
    // Listed per workspace first: a folder two workspaces share belongs to both, and the full
    // list keeps it only under the first one.
    const own = quickStartProjects(workspaces.filter(workspace => workspace.id === workspaceId))
    return own.length ? own : quickStartProjects(workspaces)
  }, [workspaces, workspaceId])
  const [projectKey, setProjectKey] = useState(() => {
    const preferred = defaultProjectAmong(workspaceId ?? null, projects.map(item => item.cwd))
    return (projects.find(item => item.cwd === preferred) ?? projects[0])?.key ?? ''
  })
  const ref = useRef<HTMLDivElement>(null)
  // Measured once: a new anchor remounts the popup (see QuickStartOverlay).
  const [position] = useState(() => popupPosition(at))
  const project = fixedProject ?? projects.find(item => item.key === projectKey) ?? projects[0] ?? null

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null
      // The "+" that opened the popup toggles it itself.
      if (target instanceof Element && target.closest(ADD_BUTTON)) return
      if (ref.current && target && !ref.current.contains(target)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const row = 'flex h-[26px] w-full items-center gap-2 rounded px-2 text-left hover:bg-[var(--bg-selected)]'
  const popup = (
    <div
      ref={ref}
      role="dialog"
      aria-label="Start a session"
      className="fixed z-[1000] flex flex-col rounded-lg border border-[var(--border-popup)] bg-[var(--bg-popup)] p-1 text-[var(--fg)] shadow-[0_8px_24px_#0006]"
      style={{ left: position.left, top: position.top, width: POPUP_WIDTH }}
      data-feature="p2.sessions.quickStart"
    >
      {!fixedProject && (
        <>
          <div className="px-2 pb-0.5 pt-1.5 text-[11.5px] text-[var(--fg-muted)]">Project</div>
          {projects.length === 0 && <div className="px-2 py-1 text-[var(--fg-muted)]">No project folders</div>}
          {projects.map(item => (
            <button
              key={item.key}
              type="button"
              role="menuitemradio"
              aria-checked={item.key === project?.key}
              onClick={() => setProjectKey(item.key)}
              className={`${row}${item.key === project?.key ? ' bg-[var(--bg-selected)]' : ''}`}
            >
              <RadioMark on={item.key === project?.key} />
              <Icon name="folder" size={16} className="flex-none text-[var(--fg-muted)]" />
              <span className="flex-none">{item.label}</span>
              <span className="min-w-0 truncate text-[var(--fg-muted)]">{item.cwd}</span>
            </button>
          ))}
          {onAddProject && (
            <button type="button" className={row} onClick={() => { onAddProject(); onClose() }}>
              <Icon name="plus" size={16} className="flex-none text-[var(--fg-muted)]" />
              Add project folder…
            </button>
          )}
          <div className="mx-1.5 my-1 h-px bg-[var(--border-strong)]" />
        </>
      )}
      <div className="px-2 pb-1 pt-1.5 text-[11.5px] text-[var(--fg-muted)]">
        {project ? `Start in ${project.label}` : 'Start'}
      </div>
      <div className="flex flex-wrap gap-1.5 px-2 pb-2">
        {QUICK_START_AGENTS.map(agent => (
          <button
            key={agent.id}
            type="button"
            aria-label={agent.label}
            onClick={() => { onStart(project, agent.command); onClose() }}
            className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-[var(--border-strong)] px-3 hover:border-[var(--accent)] hover:bg-[var(--bg-hover)]"
          >
            <Icon name={agent.command ? SESSIONS_ICON : 'terminal'} size={14} className="flex-none" />
            {agent.label}
          </button>
        ))}
      </div>
    </div>
  )
  return createPortal(popup, document.body)
}
