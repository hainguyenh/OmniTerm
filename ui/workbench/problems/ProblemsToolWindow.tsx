import { useCallback, useState, type ChangeEvent } from 'react'

import { maybeEditorService } from '../../ide/workbench/contributions'
import {
  useProblemsStore,
  type FileGroupedProblems,
  type ProblemItem,
} from './problemsStore'

export interface ProblemsToolWindowProps {
  id?: string
}

function SeverityBadge({
  label,
  count,
  active,
  color,
  onClick,
  testId,
}: {
  label: string
  count: number
  active: boolean
  color: string
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium transition-colors select-none ${
        active
          ? 'bg-[var(--bg-hover)] text-[var(--fg)] shadow-sm'
          : 'opacity-40 hover:opacity-75 text-[var(--fg-muted)]'
      }`}
    >
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span>
        {count} {label}
      </span>
    </button>
  )
}

function ProblemRow({
  problem,
  onNavigate,
}: {
  problem: ProblemItem
  onNavigate: (problem: ProblemItem) => void
}) {
  const line = problem.range.start.line + 1
  const col = problem.range.start.col + 1

  let iconColor = 'var(--info)'
  let iconLabel = 'Info'
  if (problem.severity === 'error') {
    iconColor = 'var(--danger)'
    iconLabel = 'Error'
  } else if (problem.severity === 'warning') {
    iconColor = 'var(--warning)'
    iconLabel = 'Warning'
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="problem-item"
      data-severity={problem.severity}
      onClick={() => onNavigate(problem)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onNavigate(problem)
        }
      }}
      className="group flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-xs transition-colors hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-hover)] focus:outline-none"
    >
      <span
        className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white select-none"
        style={{ backgroundColor: iconColor }}
        title={iconLabel}
      >
        {problem.severity === 'error' ? '×' : problem.severity === 'warning' ? '!' : 'i'}
      </span>

      <span className="shrink-0 font-mono text-[var(--fg-muted)] select-none">
        [{line}:{col}]
      </span>

      <span className="flex-1 break-words text-[var(--fg)]">
        {problem.message}
      </span>

      {(problem.source || problem.code) && (
        <span className="shrink-0 text-[11px] text-[var(--fg-muted)] select-none">
          {problem.source}
          {problem.code ? ` (${problem.code})` : ''}
        </span>
      )}
    </div>
  )
}

function FileSection({
  group,
  onNavigate,
}: {
  group: FileGroupedProblems
  onNavigate: (problem: ProblemItem) => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="mb-2 select-text" data-testid="problem-file-group" data-file-path={group.path}>
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full cursor-pointer items-center justify-between rounded px-1.5 py-1 text-left text-xs font-semibold hover:bg-[var(--bg-hover)]"
      >
        <div className="flex min-w-0 items-center gap-1.5 truncate">
          <span className="text-[10px] text-[var(--fg-muted)] select-none">
            {collapsed ? '▶' : '▼'}
          </span>
          <span className="truncate text-[var(--fg)]">{group.filename}</span>
          <span className="truncate text-[11px] font-normal text-[var(--fg-muted)]">
            {group.path}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pl-2 text-[11px] font-medium">
          {group.errorCount > 0 && (
            <span className="rounded bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] px-1 text-[var(--danger)]">
              {group.errorCount}
            </span>
          )}
          {group.warningCount > 0 && (
            <span className="rounded bg-[color-mix(in_srgb,var(--warning)_15%,transparent)] px-1 text-[var(--warning)]">
              {group.warningCount}
            </span>
          )}
          {group.infoCount > 0 && (
            <span className="rounded bg-[color-mix(in_srgb,var(--info)_15%,transparent)] px-1 text-[var(--info)]">
              {group.infoCount}
            </span>
          )}
        </div>
      </button>

      {!collapsed && (
        <div className="mt-0.5 ml-3 space-y-0.5 border-l border-[var(--border)] pl-2">
          {group.problems.map((prob) => (
            <ProblemRow key={prob.id} problem={prob} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
}

export function ProblemsToolWindow(_props: ProblemsToolWindowProps) {
  const totalErrors = useProblemsStore((s) => s.totalErrors)
  const totalWarnings = useProblemsStore((s) => s.totalWarnings)
  const totalInfo = useProblemsStore((s) => s.totalInfo)
  const filterSeverity = useProblemsStore((s) => s.filterSeverity)
  const searchQuery = useProblemsStore((s) => s.searchQuery)
  const groupedProblems = useProblemsStore((s) => s.groupedProblems)
  const allProblems = useProblemsStore((s) => s.allProblems)

  const toggleSeverity = useProblemsStore((s) => s.toggleSeverity)
  const setSearchQuery = useProblemsStore((s) => s.setSearchQuery)
  const resetFilters = useProblemsStore((s) => s.resetFilters)

  const handleNavigate = useCallback((problem: ProblemItem) => {
    const editor = maybeEditorService()
    if (editor?.openFile) {
      void editor.openFile(problem.path, {
        selection: {
          line: problem.range.start.line,
          col: problem.range.start.col,
        },
        focus: true,
      })
    }
    window.dispatchEvent(
      new CustomEvent('omniterm:open-file', {
        detail: {
          path: problem.path,
          line: problem.range.start.line,
          col: problem.range.start.col,
        },
      }),
    )
  }, [])

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }

  const hasAnyProblems = allProblems.length > 0
  const hasFilteredProblems = groupedProblems.length > 0

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden text-[var(--fg)]"
      data-testid="problems-tool-window"
    >
      {/* Header controls & filters */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2"
        data-testid="problems-header"
      >
        <div className="flex items-center gap-1">
          <SeverityBadge
            label="Errors"
            count={totalErrors}
            active={filterSeverity.error}
            color="var(--danger)"
            onClick={() => toggleSeverity('error')}
            testId="filter-error-btn"
          />
          <SeverityBadge
            label="Warnings"
            count={totalWarnings}
            active={filterSeverity.warning}
            color="var(--warning)"
            onClick={() => toggleSeverity('warning')}
            testId="filter-warning-btn"
          />
          <SeverityBadge
            label="Info"
            count={totalInfo}
            active={filterSeverity.info}
            color="var(--info)"
            onClick={() => toggleSeverity('info')}
            testId="filter-info-btn"
          />
        </div>

        <div className="relative flex items-center">
          <input
            type="text"
            data-testid="problems-search-input"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Filter problems..."
            className="h-6 w-36 rounded border border-[var(--border)] bg-[var(--bg-input)] px-2 text-xs text-[var(--fg)] placeholder-[var(--fg-muted)] focus:w-48 focus:border-[var(--accent)] focus:outline-none transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear filter"
              onClick={() => setSearchQuery('')}
              className="absolute right-1 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Content View */}
      <div className="flex-1 overflow-y-auto p-2">
        {!hasAnyProblems ? (
          <div
            className="flex h-full flex-col items-center justify-center p-6 text-center select-none"
            data-testid="problems-empty-state"
          >
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[var(--success)]">
              ✓
            </div>
            <h4 className="text-sm font-semibold text-[var(--fg)]">No Problems Detected</h4>
            <p className="mt-1 max-w-xs text-xs text-[var(--fg-muted)]">
              No errors, warnings, or diagnostic issues found in the active workspace.
            </p>
          </div>
        ) : !hasFilteredProblems ? (
          <div
            className="flex h-full flex-col items-center justify-center p-6 text-center select-none"
            data-testid="problems-filtered-empty"
          >
            <p className="text-xs text-[var(--fg-muted)]">
              No problems match current filters.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="mt-2 text-xs text-[var(--accent)] hover:underline"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="space-y-1" data-testid="problems-list">
            {groupedProblems.map((group) => (
              <FileSection key={group.path} group={group} onNavigate={handleNavigate} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
