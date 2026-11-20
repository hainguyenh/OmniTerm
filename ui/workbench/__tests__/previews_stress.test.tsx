/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLayoutEffect, useState } from 'react'

import { PREVIEW_CSP, withPreviewCsp } from '../../components/editor/preview/htmlPreviewCsp'
import { handleJsonGraphRequest } from '../../components/editor/preview/jsonGraphTask'
import { handleCsvRequest } from '../../components/editor/preview/csvParse'
import { usePreviewModeStore, type PreviewWrapperKind } from '../previews/previewKinds'

// Synchronous worker fallback for tests
vi.mock('../../components/editor/preview/editorWorkers', () => ({
  createCsvWorker: () => {
    throw new Error('no workers in test')
  },
  createJsonGraphWorker: () => {
    throw new Error('no workers in test')
  },
}))

// Dynamic mermaid mock for markdown testing
let mermaidShouldFail = false
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => {
      if (mermaidShouldFail) throw new Error('mermaid parse error')
      return { svg: '<svg class="rendered-diagram"></svg>' }
    }),
  },
}))

// Mock controller with controllable document manager and slot
interface MockDoc {
  text: string
}
const mockDocs = new Map<string, MockDoc>()
const mockListeners = new Set<(u: { docChanged: boolean }) => void>()
let mockReveal: ReturnType<typeof vi.fn>

vi.mock('../../ide/editor/core/controller', () => ({
  editorController: () => ({
    manager: {
      get: (path: string) => {
        const doc = mockDocs.get(path)
        if (!doc) return undefined
        return {
          sync: {
            localText: {
              toString: () => doc.text,
            },
          },
        }
      },
    },
    slotFor: (_tabId: string) => ({
      listeners: mockListeners,
      reveal: mockReveal,
    }),
  }),
}))

import { PreviewWrapper } from '../previews/PreviewWrapper'
import { CsvPreview } from '../../components/editor/preview/CsvPreview'
import { JsonGraphPreview } from '../../components/editor/preview/JsonGraphPreview'
import { HtmlPreview } from '../../components/editor/preview/HtmlPreview'
import { SvgPreview } from '../../components/editor/preview/SvgPreview'
import MarkdownPreview from '../../components/MarkdownPreview'

function sizeViewport(width: number, height: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height })
}

describe('Adversarial Stress Test: Custom Previews & CodeMirror 6 Retention', () => {
  beforeEach(() => {
    sizeViewport(800, 300)
    mockDocs.clear()
    mockListeners.clear()
    mockReveal = vi.fn()
    mermaidShouldFail = false
    usePreviewModeStore.setState({ modes: {} })

    URL.createObjectURL = vi.fn((blob: Blob) => `blob:mock-${blob.size}`) as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // Test 1: DOM retention across all 5 wrapped kinds
  const kinds: PreviewWrapperKind[] = ['markdown', 'csv', 'json-graph', 'html', 'svg']
  const sampleContents: Record<PreviewWrapperKind, string> = {
    markdown: '# Title\n**Bold**',
    csv: 'col1,col2\nval1,val2',
    'json-graph': '{"key": "value"}',
    html: '<p>Hello world</p>',
    svg: '<svg><circle cx="5" cy="5" r="5" /></svg>',
  }

  for (const kind of kinds) {
    it(`never unmounts CodeMirror children during mode switching for ${kind}`, () => {
      const path = `file.${kind}`
      const tabId = `tab-${kind}`
      mockDocs.set(path, { text: sampleContents[kind] })

      let unmountCount = 0
      let mountCount = 0

      function MockCodeMirrorEditor() {
        useLayoutEffect(() => {
          mountCount += 1
          return () => {
            unmountCount += 1
          }
        }, [])
        return <div data-testid={`cm-core-${kind}`}>CM6 Active Editor</div>
      }

      const { rerender } = render(
        <PreviewWrapper kind={kind} path={path} tabId={tabId}>
          <MockCodeMirrorEditor />
        </PreviewWrapper>,
      )

      const editorNode = screen.getByTestId(`cm-core-${kind}`)
      expect(editorNode).toBeInTheDocument()
      expect(mountCount).toBe(1)
      expect(unmountCount).toBe(0)

      // Default mode is split: wrapper parent visible
      expect(editorNode.parentElement?.style.display).not.toBe('none')

      // Switch to preview mode
      act(() => {
        usePreviewModeStore.getState().setMode(tabId, 'preview')
      })
      rerender(
        <PreviewWrapper kind={kind} path={path} tabId={tabId}>
          <MockCodeMirrorEditor />
        </PreviewWrapper>,
      )

      // DOM retention verification: exact same element instance remains in DOM with display: none
      expect(screen.getByTestId(`cm-core-${kind}`)).toBe(editorNode)
      expect(editorNode.parentElement?.style.display).toBe('none')
      expect(unmountCount).toBe(0)

      // Switch to code mode
      act(() => {
        usePreviewModeStore.getState().setMode(tabId, 'code')
      })
      rerender(
        <PreviewWrapper kind={kind} path={path} tabId={tabId}>
          <MockCodeMirrorEditor />
        </PreviewWrapper>,
      )

      expect(screen.getByTestId(`cm-core-${kind}`)).toBe(editorNode)
      expect(editorNode.parentElement?.style.display).not.toBe('none')
      expect(unmountCount).toBe(0)

      // Switch back to split mode
      act(() => {
        usePreviewModeStore.getState().setMode(tabId, 'split')
      })
      rerender(
        <PreviewWrapper kind={kind} path={path} tabId={tabId}>
          <MockCodeMirrorEditor />
        </PreviewWrapper>,
      )

      expect(screen.getByTestId(`cm-core-${kind}`)).toBe(editorNode)
      expect(mountCount).toBe(1)
      expect(unmountCount).toBe(0)
    })
  }

  // Test 2: Live document edit synchronization
  it('synchronizes live buffer edits to visualizer without reload', () => {
    const path = 'live.md'
    const tabId = 'tab-live'
    mockDocs.set(path, { text: '# Initial Heading' })

    render(
      <PreviewWrapper kind="markdown" path={path} tabId={tabId}>
        <div data-testid="cm-editor">Editor</div>
      </PreviewWrapper>,
    )

    expect(screen.getByText('Initial Heading')).toBeInTheDocument()

    // Simulate CM6 document change
    act(() => {
      mockDocs.set(path, { text: '# Updated Heading Live' })
      for (const listener of mockListeners) {
        listener({ docChanged: true })
      }
    })

    expect(screen.getByText('Updated Heading Live')).toBeInTheDocument()
    expect(screen.queryByText('Initial Heading')).toBeNull()
  })

  // Test 3: Rapid mode toggling & editor state/undo stack preservation
  it('survives rapid mode toggling without dropping editor state or throwing', () => {
    const path = 'test.csv'
    const tabId = 'tab-rapid'
    mockDocs.set(path, { text: 'a,b\n1,2' })

    function StatefulEditor() {
      const [history, setHistory] = useState<string[]>(['state-0'])
      const pushState = (s: string) => setHistory((prev) => [...prev, s])
      return (
        <div>
          <span data-testid="history-len">{history.length}</span>
          <span data-testid="latest-state">{history[history.length - 1]}</span>
          <button type="button" onClick={() => pushState(`state-${history.length}`)}>
            Edit
          </button>
        </div>
      )
    }

    const { rerender } = render(
      <PreviewWrapper kind="csv" path={path} tabId={tabId}>
        <StatefulEditor />
      </PreviewWrapper>,
    )

    // Make an edit inside editor
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByTestId('latest-state').textContent).toBe('state-1')

    // Rapidly toggle modes 60 times
    const modes: Array<'code' | 'preview' | 'split'> = ['preview', 'code', 'split', 'preview']
    act(() => {
      for (let i = 0; i < 60; i += 1) {
        usePreviewModeStore.getState().setMode(tabId, modes[i % modes.length])
      }
    })

    rerender(
      <PreviewWrapper kind="csv" path={path} tabId={tabId}>
        <StatefulEditor />
      </PreviewWrapper>,
    )

    // State, history length, and latest state must be 100% intact
    expect(screen.getByTestId('history-len').textContent).toBe('2')
    expect(screen.getByTestId('latest-state').textContent).toBe('state-1')
  })

  // Test 4: Malformed and pathological JSON handling
  describe('Malformed JSON Handling', () => {
    it('gracefully handles invalid syntax and triggers cursor reveal on error', () => {
      const malformedPayloads = [
        '{',
        '{"key": 1,}',
        '{"unquoted": val}',
        '{"deep": {"nested": [1, 2, }',
        '', // 0-character empty text is invalid JSON
      ]

      for (const malformed of malformedPayloads) {
        const res = handleJsonGraphRequest({ text: malformed, collapsed: [] })
        expect(res.result.ok).toBe(false)
        if (!res.result.ok) {
          expect(typeof res.result.message).toBe('string')
          expect(res.result.message.length).toBeGreaterThan(0)
        }
      }

      // Render in JsonGraphPreview and test error banner + reveal
      const onReveal = vi.fn()
      render(<JsonGraphPreview text="{'bad': true}" onReveal={onReveal} />)
      expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument()

      const goBtn = screen.getByRole('button', { name: 'Go to error' })
      expect(goBtn).toBeInTheDocument()
      fireEvent.click(goBtn)
      expect(onReveal).toHaveBeenCalled()
    })

    it('handles primitive roots and empty structures without throwing', () => {
      for (const prim of ['null', 'true', 'false', '12345', '"simple string"', '[]', '{}']) {
        const res = handleJsonGraphRequest({ text: prim, collapsed: [] })
        expect(res.result.ok).toBe(true)
      }
    })

    it('handles deeply nested JSON trees within safety limits', () => {
      let nested: Record<string, unknown> = { val: 1 }
      for (let i = 0; i < 100; i += 1) {
        nested = { child: nested }
      }
      const res = handleJsonGraphRequest({ text: JSON.stringify(nested), collapsed: [] })
      expect(res.result.ok).toBe(true)
    })
  })

  // Test 5: Empty, ragged, and unterminated CSV / TSV
  describe('Degenerate CSV & TSV Handling', () => {
    it('handles empty input, newlines, and single comma cleanly', () => {
      for (const empty of ['', '\n', '\r\n\r\n', ',', 'col1\tcol2\tcol3']) {
        const scan = handleCsvRequest({ text: empty, fileName: 'test.csv' }).result
        expect(scan.rowCount).toBeGreaterThanOrEqual(0)
      }

      const { container } = render(<CsvPreview text="" fileName="empty.csv" />)
      expect(container.querySelector('.csv-preview')).toBeInTheDocument()
      expect(screen.getByText(/0 rows × 0 columns/)).toBeInTheDocument()
    })

    it('handles unterminated quotes without hanging or throwing', () => {
      const unclosed = 'id,data\n1,"unterminated string that never ends\n2,normal'
      const scan = handleCsvRequest({ text: unclosed, fileName: 'unclosed.csv' }).result
      expect(scan.literalFrom).toBeLessThanOrEqual(scan.rowCount)

      render(<CsvPreview text={unclosed} fileName="unclosed.csv" />)
      expect(screen.getByText(/is never closed/)).toBeInTheDocument()
    })
  })

  // Test 6: Pathological Markdown & Mermaid Fallback
  describe('Pathological Markdown Handling', () => {
    it('handles huge markdown buffers and falls back on broken mermaid syntax', async () => {
      mermaidShouldFail = true
      const fallback = vi.fn()
      const bigMarkdown = [
        '# Header',
        ...Array.from({ length: 500 }, (_, i) => `Paragraph line ${i} with **formatted** text.`),
        '```mermaid\ninvalid mermaid syntax\n```',
      ].join('\n')

      render(<MarkdownPreview content={bigMarkdown} onFallback={fallback} />)

      // Fallback pre block should be displayed for the failed mermaid diagram
      const fallbackPre = await screen.findByText('invalid mermaid syntax')
      expect(fallbackPre).toHaveClass('markdown-mermaid-fallback')
    })
  })

  // Test 7: Adversarial HTML Injection & Sandbox Defense
  describe('Adversarial HTML Sandbox Security', () => {
    const maliciousPayloads = [
      '<script>window.top.location="http://evil.com"</script>',
      '<img src="missing.jpg" onerror="alert(1)">',
      '<iframe src="javascript:alert(document.cookie)"></iframe>',
      '<meta http-equiv="refresh" content="0;url=http://attacker.com">',
      '<HEAD lang="en" class="test"><link rel="stylesheet" href="http://evil.com/style.css"></HEAD>',
    ]

    for (const payload of maliciousPayloads) {
      it(`enforces strict sandbox and prepends CSP meta on: ${payload.slice(0, 30)}...`, () => {
        const { container } = render(<HtmlPreview html={payload} />)
        const frame = container.querySelector('iframe')

        expect(frame).not.toBeNull()
        expect(frame?.getAttribute('sandbox')).toBe('')
        expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer')

        const srcDoc = frame?.getAttribute('srcdoc') ?? ''
        expect(srcDoc).toContain(`content="${PREVIEW_CSP}"`)

        // Ensure CSP meta is present
        expect(withPreviewCsp(payload)).toMatch(new RegExp(PREVIEW_CSP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      })
    }
  })

  // Test 8: SvgPreview with malformed XML
  describe('SvgPreview Edge Cases', () => {
    it('handles malformed SVG tags without throwing', () => {
      const malformedSvg = '<svg><unclosed><circle'
      const { container } = render(<SvgPreview text={malformedSvg} fileName="bad.svg" />)
      expect(container).toBeInTheDocument()
      expect(URL.createObjectURL).toHaveBeenCalled()
    })
  })
})
