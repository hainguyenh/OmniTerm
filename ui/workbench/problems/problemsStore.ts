import { create } from 'zustand'

import type { Diagnostic, Severity } from '../../ide/bindings'
import { applyProfile, inspectionProfile, subscribeInspectionProfile } from '../../ide/platform/inspections'
import { isTauri, onIdeEvent } from '../../ide/platform/ipc'
import { onLocalDiagnostics } from '../../ide/platform/localDiagnostics'

export interface ProblemItem {
  id: string
  path: string
  range: {
    start: { line: number; col: number }
    end: { line: number; col: number }
  }
  severity: Severity
  message: string
  source: string | null
  code: string | null
  server?: string | null
}

export interface FileGroupedProblems {
  path: string
  filename: string
  problems: ProblemItem[]
  errorCount: number
  warningCount: number
  infoCount: number
}

export interface SeverityFilter {
  error: boolean
  warning: boolean
  info: boolean
}

export interface ProblemsState {
  /** Map of path -> (source -> Diagnostic[]) */
  diagnosticsByPath: Map<string, Map<string, Diagnostic[]>>
  filterSeverity: SeverityFilter
  searchQuery: string
  totalErrors: number
  totalWarnings: number
  totalInfo: number
  allProblems: ProblemItem[]
  groupedProblems: FileGroupedProblems[]

  setDiagnostics: (path: string, source: string, items: Diagnostic[]) => void
  clearDiagnostics: (path?: string) => void
  setFilterSeverity: (severity: keyof SeverityFilter, enabled: boolean) => void
  toggleSeverity: (severity: keyof SeverityFilter) => void
  setSearchQuery: (query: string) => void
  resetFilters: () => void
  reset: () => void
}

function computeDerived(
  diagnosticsByPath: Map<string, Map<string, Diagnostic[]>>,
  filterSeverity: SeverityFilter,
  searchQuery: string,
) {
  const allProblems: ProblemItem[] = []
  let totalErrors = 0
  let totalWarnings = 0
  let totalInfo = 0
  // The editor shows diagnostics under the inspection profile (disabled ones dropped, severities
  // remapped, e.g. to Weak Warning); the list must match it, so it applies the same profile.
  const profile = inspectionProfile()

  for (const [path, sources] of diagnosticsByPath.entries()) {
    for (const [source, items] of sources.entries()) {
      for (const item of applyProfile(profile, source, items)) {
        const severity = item.severity
        if (severity === 'error') totalErrors++
        else if (severity === 'warning') totalWarnings++
        else totalInfo++

        allProblems.push({
          id: `${path}:${item.range.start.line}:${item.range.start.col}:${item.source ?? source}:${item.code ?? ''}:${item.message}`,
          path,
          range: item.range,
          severity,
          message: item.message,
          source: item.source ?? source,
          code: item.code ?? null,
          server: item.server ?? null,
        })
      }
    }
  }

  // Filter problems
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const filtered = allProblems.filter((p) => {
    // Severity filter
    if (p.severity === 'error' && !filterSeverity.error) return false
    if (p.severity === 'warning' && !filterSeverity.warning) return false
    if ((p.severity === 'info' || p.severity === 'hint') && !filterSeverity.info) return false

    // Search query filter
    if (normalizedQuery.length > 0) {
      const matchMessage = p.message.toLowerCase().includes(normalizedQuery)
      const matchPath = p.path.toLowerCase().includes(normalizedQuery)
      const matchSource = p.source?.toLowerCase().includes(normalizedQuery) ?? false
      const matchCode = p.code?.toLowerCase().includes(normalizedQuery) ?? false
      if (!matchMessage && !matchPath && !matchSource && !matchCode) return false
    }

    return true
  })

  // Group by file
  const groupsByPath = new Map<string, ProblemItem[]>()
  for (const p of filtered) {
    let list = groupsByPath.get(p.path)
    if (!list) {
      list = []
      groupsByPath.set(p.path, list)
    }
    list.push(p)
  }

  const groupedProblems: FileGroupedProblems[] = []
  for (const [path, problems] of groupsByPath.entries()) {
    // Sort problems by start line, then column
    problems.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.col - b.range.start.col)

    let errorCount = 0
    let warningCount = 0
    let infoCount = 0
    for (const p of problems) {
      if (p.severity === 'error') errorCount++
      else if (p.severity === 'warning') warningCount++
      else infoCount++
    }

    const segments = path.replace(/\\/g, '/').split('/')
    const filename = segments.at(-1) || path

    groupedProblems.push({
      path,
      filename,
      problems,
      errorCount,
      warningCount,
      infoCount,
    })
  }

  // Sort groups: most errors first, then warnings, then filename
  groupedProblems.sort((a, b) => {
    if (b.errorCount !== a.errorCount) return b.errorCount - a.errorCount
    if (b.warningCount !== a.warningCount) return b.warningCount - a.warningCount
    return a.filename.localeCompare(b.filename)
  })

  return {
    allProblems,
    totalErrors,
    totalWarnings,
    totalInfo,
    groupedProblems,
  }
}

const DEFAULT_FILTER: SeverityFilter = {
  error: true,
  warning: true,
  info: true,
}

export const useProblemsStore = create<ProblemsState>((set, get) => ({
  diagnosticsByPath: new Map(),
  filterSeverity: { ...DEFAULT_FILTER },
  searchQuery: '',
  totalErrors: 0,
  totalWarnings: 0,
  totalInfo: 0,
  allProblems: [],
  groupedProblems: [],

  setDiagnostics: (path: string, source: string, items: Diagnostic[]) => {
    const nextMap = new Map(get().diagnosticsByPath)
    const sources = nextMap.get(path)

    if (!items.length) {
      if (sources) {
        const nextSources = new Map(sources)
        nextSources.delete(source)
        if (nextSources.size === 0) {
          nextMap.delete(path)
        } else {
          nextMap.set(path, nextSources)
        }
      }
    } else {
      const nextSources = new Map(sources ?? [])
      nextSources.set(source, items)
      nextMap.set(path, nextSources)
    }

    const derived = computeDerived(nextMap, get().filterSeverity, get().searchQuery)
    set({
      diagnosticsByPath: nextMap,
      ...derived,
    })
  },

  clearDiagnostics: (path?: string) => {
    let nextMap: Map<string, Map<string, Diagnostic[]>>
    if (path) {
      nextMap = new Map(get().diagnosticsByPath)
      nextMap.delete(path)
    } else {
      nextMap = new Map()
    }
    const derived = computeDerived(nextMap, get().filterSeverity, get().searchQuery)
    set({
      diagnosticsByPath: nextMap,
      ...derived,
    })
  },

  setFilterSeverity: (severity: keyof SeverityFilter, enabled: boolean) => {
    const nextFilter = { ...get().filterSeverity, [severity]: enabled }
    const derived = computeDerived(get().diagnosticsByPath, nextFilter, get().searchQuery)
    set({
      filterSeverity: nextFilter,
      ...derived,
    })
  },

  toggleSeverity: (severity: keyof SeverityFilter) => {
    const nextFilter = {
      ...get().filterSeverity,
      [severity]: !get().filterSeverity[severity],
    }
    const derived = computeDerived(get().diagnosticsByPath, nextFilter, get().searchQuery)
    set({
      filterSeverity: nextFilter,
      ...derived,
    })
  },

  setSearchQuery: (searchQuery: string) => {
    const derived = computeDerived(get().diagnosticsByPath, get().filterSeverity, searchQuery)
    set({
      searchQuery,
      ...derived,
    })
  },

  resetFilters: () => {
    const derived = computeDerived(get().diagnosticsByPath, { ...DEFAULT_FILTER }, '')
    set({
      filterSeverity: { ...DEFAULT_FILTER },
      searchQuery: '',
      ...derived,
    })
  },

  reset: () => {
    const nextMap = new Map<string, Map<string, Diagnostic[]>>()
    const derived = computeDerived(nextMap, { ...DEFAULT_FILTER }, '')
    set({
      diagnosticsByPath: nextMap,
      filterSeverity: { ...DEFAULT_FILTER },
      searchQuery: '',
      ...derived,
    })
  },
}))

let eventDisposer: (() => void) | null = null

/**
 * Initializes subscription to backend IDE diagnostics and filesystem events.
 * Safe to call multiple times (returns existing or fresh disposer).
 */
export function initProblemsEvents(): () => void {
  if (eventDisposer) return eventDisposer

  const unlistenDiagnostics = onIdeEvent('diagnostics', (e) => {
    useProblemsStore.getState().setDiagnostics(e.path, e.source, e.items)
  })

  // Typo, file-reference and SQL inspections run in the editor itself and never reach the backend
  // event; without them the editor listed a (weak) warning that Problems did not.
  const unlistenLocal = onLocalDiagnostics((path, producer, items) => {
    useProblemsStore.getState().setDiagnostics(path, producer, [...items])
  })

  const unlistenProfile = subscribeInspectionProfile(() => {
    useProblemsStore.setState((s) => computeDerived(s.diagnosticsByPath, s.filterSeverity, s.searchQuery))
  })

  const unlistenFs = onIdeEvent('fsChanged', (e) => {
    if (e.removed && e.removed.length > 0) {
      for (const removedPath of e.removed) {
        useProblemsStore.getState().clearDiagnostics(removedPath)
      }
    }
  })

  eventDisposer = () => {
    unlistenDiagnostics()
    unlistenLocal()
    unlistenProfile()
    unlistenFs()
    eventDisposer = null
  }

  return eventDisposer
}

// Auto-initialize if running in a window or Tauri environment
if (typeof window !== 'undefined' && isTauri()) {
  initProblemsEvents()
}
