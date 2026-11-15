/**
 * @vitest-environment jsdom
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Diagnostic } from '../../ide/bindings'
import { emitLocalIdeEvent } from '../../ide/platform/ipc'
import { ProblemsToolWindow } from '../problems/ProblemsToolWindow'
import { initProblemsEvents, useProblemsStore } from '../problems/problemsStore'

const openFileMock = vi.fn()
let editorServiceAvailable = true

vi.mock('../../ide/workbench/contributions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ide/workbench/contributions')>()
  return {
    ...actual,
    maybeEditorService: () => (editorServiceAvailable ? { openFile: openFileMock } : undefined),
    editorService: () => ({ openFile: openFileMock }),
  }
})

function createDiag(line: number, col: number, sev: Diagnostic['severity'], msg: string, code?: string): Diagnostic {
  return {
    range: { start: { line, col }, end: { line, col: col + 5 } },
    severity: sev,
    message: msg,
    source: 'rust-analyzer',
    code: code ?? null,
  }
}

describe('Milestone 3 Problems Subsystem — Adversarial Stress & Correctness', () => {
  beforeEach(() => {
    openFileMock.mockReset().mockResolvedValue(undefined)
    editorServiceAvailable = true
    act(() => {
      useProblemsStore.getState().reset()
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Stress: floods store with 1,200+ diagnostics across 50 files with fast aggregation', () => {
    const fileCount = 50
    const perFileDiags = 24 // 10 errors, 8 warnings, 6 info => 1,200 total

    const start = performance.now()
    act(() => {
      for (let f = 0; f < fileCount; f++) {
        const filePath = `/workspace/src/module_${f}/service_${f}.rs`
        const diags: Diagnostic[] = []
        for (let i = 0; i < perFileDiags; i++) {
          const sev = i < 10 ? 'error' : i < 18 ? 'warning' : 'info'
          diags.push(createDiag(i * 5, (i * 2) % 40, sev, `Diag ${i} mod ${f}`, `E0${100 + i}`))
        }
        useProblemsStore.getState().setDiagnostics(filePath, 'rust-analyzer', diags)
      }
    })
    const durationMs = performance.now() - start

    const state = useProblemsStore.getState()
    expect(durationMs).toBeLessThan(350)
    expect(state.totalErrors).toBe(500)
    expect(state.totalWarnings).toBe(400)
    expect(state.totalInfo).toBe(300)
    expect(state.allProblems.length).toBe(1200)
    expect(state.groupedProblems.length).toBe(50)

    // Verify ordering: descending errorCount, then warningCount
    for (let i = 1; i < state.groupedProblems.length; i++) {
      const prev = state.groupedProblems[i - 1]
      const curr = state.groupedProblems[i]
      if (prev.errorCount === curr.errorCount) {
        expect(prev.warningCount).toBeGreaterThanOrEqual(curr.warningCount)
      } else {
        expect(prev.errorCount).toBeGreaterThan(curr.errorCount)
      }
    }

    // Deduplication & replacement: update module_0 with 2 errors
    act(() => {
      useProblemsStore.getState().setDiagnostics('/workspace/src/module_0/service_0.rs', 'rust-analyzer', [
        createDiag(1, 0, 'error', 'Syntax error replaced', 'E0001'),
        createDiag(2, 0, 'error', 'Type mismatch replaced', 'E0308'),
      ])
    })
    const updated = useProblemsStore.getState()
    expect(updated.totalErrors).toBe(492)
    expect(updated.totalWarnings).toBe(392)
    expect(updated.totalInfo).toBe(294)

    // Multi-producer: clippy diagnostics added to same file
    act(() => {
      useProblemsStore.getState().setDiagnostics('/workspace/src/module_0/service_0.rs', 'clippy', [
        {
          range: { start: { line: 10, col: 0 }, end: { line: 10, col: 5 } },
          severity: 'warning',
          message: 'Clippy: needless return',
          source: 'clippy',
          code: 'clippy::needless_return',
        },
      ])
    })
    expect(useProblemsStore.getState().totalWarnings).toBe(393)

    // Clear single file and clear all
    act(() => {
      useProblemsStore.getState().clearDiagnostics('/workspace/src/module_0/service_0.rs')
    })
    expect(useProblemsStore.getState().diagnosticsByPath.has('/workspace/src/module_0/service_0.rs')).toBe(false)
    act(() => {
      useProblemsStore.getState().clearDiagnostics()
    })
    expect(useProblemsStore.getState().allProblems.length).toBe(0)
  })

  it('Stress: rapid burst toggles and search queries maintain store invariants', () => {
    act(() => {
      for (let f = 0; f < 30; f++) {
        const filePath = `/src/file_${f}.ts`
        useProblemsStore.getState().setDiagnostics(filePath, 'eslint', [
          createDiag(1, 0, 'error', `Syntax error in file_${f}`, 'parse-err'),
          createDiag(2, 0, 'warning', `Unused var in file_${f}`, 'no-unused-vars'),
        ])
      }
    })

    const queries = ['syntax', 'file_1', 'no-unused-vars', 'parse-err', '', 'nonexistent']
    const severities: ('error' | 'warning' | 'info')[] = ['error', 'warning', 'info']

    act(() => {
      for (let op = 0; op < 180; op++) {
        useProblemsStore.getState().toggleSeverity(severities[op % 3])
        useProblemsStore.getState().setSearchQuery(queries[op % queries.length])

        const st = useProblemsStore.getState()
        expect(st.totalErrors).toBe(30)
        expect(st.totalWarnings).toBe(30)
        expect(st.allProblems.length).toBe(60)

        for (const group of st.groupedProblems) {
          for (const item of group.problems) {
            if (item.severity === 'error') expect(st.filterSeverity.error).toBe(true)
            if (item.severity === 'warning') expect(st.filterSeverity.warning).toBe(true)
            if (item.severity === 'info') expect(st.filterSeverity.info).toBe(true)
          }
        }
      }
    })

    act(() => {
      useProblemsStore.getState().resetFilters()
    })
    expect(useProblemsStore.getState().groupedProblems.length).toBe(30)
  })

  it('Boundary: handles extreme paths, negative/extreme coordinates, and 100KB messages', () => {
    const deepPath = `C:/repo/${'sub/'.repeat(50)}nested_file.rs`
    const unicodePath = '/workspace/🦀/файлы/测试_파일.ts'
    const hugeMessage = 'E'.repeat(100_000)

    act(() => {
      useProblemsStore.getState().setDiagnostics(deepPath, 'rust-analyzer', [
        createDiag(-100, -5, 'error', 'Negative coordinates handled'),
      ])
      useProblemsStore.getState().setDiagnostics(unicodePath, 'typescript', [
        {
          range: {
            start: { line: Number.MAX_SAFE_INTEGER, col: 1_000_000 },
            end: { line: Number.MAX_SAFE_INTEGER, col: 1_000_010 },
          },
          severity: 'warning',
          message: hugeMessage,
          source: 'tsc',
          code: 'TS9999',
        },
      ])
      useProblemsStore.getState().setDiagnostics('', 'empty-path', [
        createDiag(50, 10, 'info', 'Empty path handled'),
      ])
    })

    const state = useProblemsStore.getState()
    expect(state.allProblems.length).toBe(3)
    expect(state.totalErrors).toBe(1)
    expect(state.totalWarnings).toBe(1)
    expect(state.totalInfo).toBe(1)

    // Fast substring search on 100KB message without ReDoS or crash
    const searchStart = performance.now()
    act(() => {
      useProblemsStore.getState().setSearchQuery('EEEE')
    })
    expect(performance.now() - searchStart).toBeLessThan(30)
    expect(useProblemsStore.getState().groupedProblems.length).toBe(1)

    act(() => {
      useProblemsStore.getState().setSearchQuery('.*+?^${}()|[]\\')
    })
    expect(useProblemsStore.getState().groupedProblems.length).toBe(0)
  })

  it('Empirical Challenge: surfaces vulnerability when untrusted IPC sends null message', () => {
    act(() => {
      useProblemsStore.getState().setDiagnostics('/src/broken.rs', 'external-plugin', [
        {
          range: { start: { line: 0, col: 0 }, end: { line: 0, col: 1 } },
          severity: 'error',
          message: null as unknown as string,
          source: 'plugin',
          code: 'ERR',
        },
      ])
    })

    // Store accepts untrusted input when search query is empty
    expect(useProblemsStore.getState().allProblems.length).toBe(1)

    // Missing null-coalescing on p.message raises TypeError during search evaluation
    expect(() => {
      act(() => {
        useProblemsStore.getState().setSearchQuery('test')
      })
    }).toThrow(TypeError)
  })

  it('Navigation: handles nonexistent files, locked files, and headless mode safely', () => {
    const customEventSpy = vi.fn()
    window.addEventListener('omniterm:open-file', customEventSpy)

    act(() => {
      useProblemsStore.getState().setDiagnostics('/nonexistent/path/ghost.rs', 'compiler', [
        createDiag(15, 8, 'error', 'Cannot find symbol', 'E0425'),
      ])
    })

    const { unmount } = render(React.createElement(ProblemsToolWindow, {}))
    const item = screen.getByTestId('problem-item')

    // Scenario A: openFile succeeds
    fireEvent.click(item)
    expect(openFileMock).toHaveBeenCalledWith(
      '/nonexistent/path/ghost.rs',
      expect.objectContaining({ selection: { line: 15, col: 8 }, focus: true }),
    )
    expect(customEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { path: '/nonexistent/path/ghost.rs', line: 15, col: 8 },
      }),
    )

    // Scenario B: locked file rejection does not crash navigation handler
    openFileMock.mockRejectedValueOnce(new Error('FileLockedError: locked by OS'))
    expect(() => {
      fireEvent.click(item)
    }).not.toThrow()

    // Scenario C: headless mode / maybeEditorService returns undefined
    editorServiceAvailable = false
    expect(() => {
      fireEvent.click(item)
    }).not.toThrow()
    expect(customEventSpy).toHaveBeenCalledTimes(3)

    unmount()
    window.removeEventListener('omniterm:open-file', customEventSpy)
  })

  it('Lifecycle & Memory: verified idempotent disposal and zero leaked store listeners', () => {
    const disposer1 = initProblemsEvents()
    const disposer2 = initProblemsEvents()
    expect(disposer1).toBe(disposer2)

    act(() => {
      emitLocalIdeEvent({
        type: 'diagnostics',
        path: '/ws/event.rs',
        source: 'rust-analyzer',
        items: [createDiag(1, 0, 'error', 'Live event error')],
      })
    })
    expect(useProblemsStore.getState().totalErrors).toBe(1)

    disposer1()

    act(() => {
      emitLocalIdeEvent({
        type: 'diagnostics',
        path: '/ws/event2.rs',
        source: 'rust-analyzer',
        items: [createDiag(1, 0, 'error', 'Ignored after dispose')],
      })
    })
    expect(useProblemsStore.getState().diagnosticsByPath.has('/ws/event2.rs')).toBe(false)

    // Store unsubscription and memory leak test with 100 concurrent subscribers
    const notifications: number[] = []
    const unsubs: (() => void)[] = []

    for (let i = 0; i < 100; i++) {
      const idx = i
      const unsub = useProblemsStore.subscribe(() => {
        notifications.push(idx)
      })
      unsubs.push(unsub)
    }

    act(() => {
      useProblemsStore.getState().setSearchQuery('burst')
    })
    expect(notifications.length).toBe(100)

    for (const unsub of unsubs) unsub()
    notifications.length = 0

    act(() => {
      useProblemsStore.getState().setSearchQuery('')
    })
    expect(notifications.length).toBe(0)
  })
})
