/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Diagnostic } from '../../ide/bindings'
import { emitLocalIdeEvent } from '../../ide/platform/ipc'
import { publishLocalDiagnostics } from '../../ide/platform/localDiagnostics'

const openFileMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../../ide/workbench/contributions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ide/workbench/contributions')>()
  return {
    ...actual,
    maybeEditorService: () => ({ openFile: openFileMock }),
    editorService: () => ({ openFile: openFileMock }),
  }
})

import { ProblemsToolWindow } from '../problems/ProblemsToolWindow'
import {
  initProblemsEvents,
  useProblemsStore,
} from '../problems/problemsStore'

describe('ProblemsToolWindow & problemsStore', () => {
  beforeEach(() => {
    openFileMock.mockClear()
    act(() => {
      useProblemsStore.getState().reset()
    })
  })

  it('renders clean empty state when no problems exist', () => {
    render(<ProblemsToolWindow />)
    expect(screen.getByTestId('problems-empty-state')).toBeTruthy()
    expect(screen.getByText('No Problems Detected')).toBeTruthy()
  })

  it('aggregates diagnostics across files and groups them', () => {
    const fileADiags: Diagnostic[] = [
      {
        range: { start: { line: 10, col: 2 }, end: { line: 10, col: 15 } },
        severity: 'error',
        message: 'cannot find value `x` in this scope',
        source: 'rust-analyzer',
        code: 'E0425',
      },
      {
        range: { start: { line: 20, col: 4 }, end: { line: 20, col: 8 } },
        severity: 'warning',
        message: 'unused variable `y`',
        source: 'rust-analyzer',
        code: 'unused_variables',
      },
    ]

    const fileBDiags: Diagnostic[] = [
      {
        range: { start: { line: 5, col: 0 }, end: { line: 5, col: 10 } },
        severity: 'info',
        message: 'consider annotating type',
        source: 'rust-analyzer',
        code: null,
      },
    ]

    act(() => {
      useProblemsStore.getState().setDiagnostics('/workspace/src/a.rs', 'rust-analyzer', fileADiags)
      useProblemsStore.getState().setDiagnostics('/workspace/src/b.rs', 'rust-analyzer', fileBDiags)
    })

    render(<ProblemsToolWindow />)

    expect(screen.queryByTestId('problems-empty-state')).toBeNull()
    expect(screen.getByTestId('problems-list')).toBeTruthy()

    // Severity badges in header
    expect(screen.getByTestId('filter-error-btn').textContent).toContain('1 Errors')
    expect(screen.getByTestId('filter-warning-btn').textContent).toContain('1 Warnings')
    expect(screen.getByTestId('filter-info-btn').textContent).toContain('1 Info')

    // File groups rendered
    const groups = screen.getAllByTestId('problem-file-group')
    expect(groups.length).toBe(2)

    // Items rendered
    const items = screen.getAllByTestId('problem-item')
    expect(items.length).toBe(3)

    // Only the theme's own tokens: undefined ones fell back to dark colours in the light theme.
    expect(document.body.innerHTML).not.toMatch(/--(foreground|surface|primary|error|border-subtle)\b|--\w+-bg\b|#[0-9a-f]{3,6}\b/)
  })

  it('filters problems by severity when toggle buttons are clicked', () => {
    act(() => {
      useProblemsStore.getState().setDiagnostics('/ws/main.rs', 'compiler', [
        {
          range: { start: { line: 1, col: 0 }, end: { line: 1, col: 5 } },
          severity: 'error',
          message: 'Syntax error',
          source: 'compiler',
          code: null,
        },
        {
          range: { start: { line: 2, col: 0 }, end: { line: 2, col: 5 } },
          severity: 'warning',
          message: 'Unused import',
          source: 'compiler',
          code: null,
        },
      ])
    })

    render(<ProblemsToolWindow />)
    expect(screen.getAllByTestId('problem-item').length).toBe(2)

    // Toggle off Errors
    fireEvent.click(screen.getByTestId('filter-error-btn'))
    expect(screen.getAllByTestId('problem-item').length).toBe(1)
    expect(screen.getByText('Unused import')).toBeTruthy()

    // Toggle off Warnings
    fireEvent.click(screen.getByTestId('filter-warning-btn'))
    expect(screen.queryAllByTestId('problem-item').length).toBe(0)
    expect(screen.getByTestId('problems-filtered-empty')).toBeTruthy()

    // Reset filters
    fireEvent.click(screen.getByText('Reset Filters'))
    expect(screen.getAllByTestId('problem-item').length).toBe(2)
  })

  it('filters problems by search text', () => {
    act(() => {
      useProblemsStore.getState().setDiagnostics('/ws/app.ts', 'eslint', [
        {
          range: { start: { line: 4, col: 2 }, end: { line: 4, col: 10 } },
          severity: 'error',
          message: 'Missing return type',
          source: 'typescript',
          code: 'TS7050',
        },
        {
          range: { start: { line: 12, col: 0 }, end: { line: 12, col: 5 } },
          severity: 'warning',
          message: 'no-unused-vars',
          source: 'eslint',
          code: 'no-unused-vars',
        },
      ])
    })

    render(<ProblemsToolWindow />)
    expect(screen.getAllByTestId('problem-item').length).toBe(2)

    const searchInput = screen.getByTestId('problems-search-input')
    fireEvent.change(searchInput, { target: { value: 'return type' } })
    expect(screen.getAllByTestId('problem-item').length).toBe(1)
    expect(screen.getByText('Missing return type')).toBeTruthy()

    // Search by code
    fireEvent.change(searchInput, { target: { value: 'TS7050' } })
    expect(screen.getAllByTestId('problem-item').length).toBe(1)

    // Non-matching search
    fireEvent.change(searchInput, { target: { value: 'nonexistent-problem-query' } })
    expect(screen.queryAllByTestId('problem-item').length).toBe(0)
    expect(screen.getByTestId('problems-filtered-empty')).toBeTruthy()
  })

  it('clicking a problem item navigates to the target file and line:column', () => {
    const customEventSpy = vi.fn()
    window.addEventListener('omniterm:open-file', customEventSpy)

    act(() => {
      useProblemsStore.getState().setDiagnostics('/ws/src/index.ts', 'tsserver', [
        {
          range: { start: { line: 41, col: 11 }, end: { line: 41, col: 20 } },
          severity: 'error',
          message: 'Property `foo` does not exist on type `Bar`',
          source: 'tsserver',
          code: '2339',
        },
      ])
    })

    render(<ProblemsToolWindow />)

    const item = screen.getByTestId('problem-item')
    fireEvent.click(item)

    expect(openFileMock).toHaveBeenCalledWith(
      '/ws/src/index.ts',
      expect.objectContaining({
        selection: { line: 41, col: 11 },
        focus: true,
      }),
    )

    expect(customEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { path: '/ws/src/index.ts', line: 41, col: 11 },
      }),
    )

    window.removeEventListener('omniterm:open-file', customEventSpy)
  })

  it('subscribes to ide://event diagnostics automatically', () => {
    const cleanup = initProblemsEvents()

    act(() => {
      emitLocalIdeEvent({
        type: 'diagnostics',
        path: '/ws/lib.rs',
        source: 'rust-analyzer',
        items: [
          {
            range: { start: { line: 3, col: 4 }, end: { line: 3, col: 10 } },
            severity: 'error',
            message: 'mismatched types',
            source: 'rust-analyzer',
            code: 'E0308',
          },
        ],
      })
    })

    expect(useProblemsStore.getState().totalErrors).toBe(1)
    expect(useProblemsStore.getState().groupedProblems[0]?.filename).toBe('lib.rs')

    // Clears when empty list published
    act(() => {
      emitLocalIdeEvent({
        type: 'diagnostics',
        path: '/ws/lib.rs',
        source: 'rust-analyzer',
        items: [],
      })
    })

    expect(useProblemsStore.getState().totalErrors).toBe(0)
    expect(useProblemsStore.getState().groupedProblems.length).toBe(0)

    cleanup()
  })

  // Regression: a weak warning from an inspection the editor runs itself (typo, file reference, SQL)
  // showed in the editor's inspection widget but never in Problems.
  it('lists diagnostics the editor computes locally', () => {
    const cleanup = initProblemsEvents()
    const weak: Diagnostic = {
      range: { start: { line: 1, col: 0 }, end: { line: 1, col: 4 } },
      severity: 'info',
      message: 'Cannot resolve file',
      source: null,
      code: null,
    }

    act(() => publishLocalDiagnostics('/ws/a.md', 'fileReferences', [weak]))
    expect(useProblemsStore.getState().totalInfo).toBe(1)
    expect(useProblemsStore.getState().groupedProblems[0]?.filename).toBe('a.md')

    act(() => publishLocalDiagnostics('/ws/a.md', 'fileReferences', []))
    expect(useProblemsStore.getState().totalInfo).toBe(0)

    cleanup()
  })
})
