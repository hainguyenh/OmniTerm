/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MarkdownPreview from '../MarkdownPreview'

let markdownThrows = false
vi.mock('react-markdown', () => ({
  default: ({ children, components }: any) => {
    if (markdownThrows) throw new Error('markdown exploded')
    const source = String(children)
    const match = /```(\w+)?\n([\s\S]*?)```/.exec(source)
    if (match) {
      return <>{components.code({ className: match[1] ? `language-${match[1]}` : undefined, children: `${match[2]}\n` })}</>
    }
    return <p>{source}</p>
  },
}))
vi.mock('remark-gfm', () => ({ default: {} }))

let mermaidRender: any
const initialize = vi.fn()
vi.mock('mermaid', () => ({
  default: {
    initialize: (...args: unknown[]) => initialize(...args),
    render: (id: string, text: string) => mermaidRender(id, text),
  },
}))

beforeEach(() => {
  markdownThrows = false
  mermaidRender = vi.fn(async () => ({ svg: '<svg data-testid="diagram"></svg>' }))
  initialize.mockClear()
  vi.useRealTimers()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('MarkdownPreview complete behavior', () => {
  it('renders normal markdown and ordinary fenced code without Mermaid work', () => {
    const fallback = vi.fn()
    const { rerender } = render(<MarkdownPreview content="hello" onFallback={fallback} />)
    expect(screen.getByText('hello')).toBeInTheDocument()
    rerender(<MarkdownPreview content={'```ts\nconst x = 1\n```'} onFallback={fallback} />)
    expect(screen.getByText('const x = 1')).toHaveClass('language-ts')
    expect(initialize).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('initializes strict Mermaid and renders successful SVG', async () => {
    const fallback = vi.fn()
    render(<MarkdownPreview content={'```mermaid\ngraph TD; A-->B\n```'} onFallback={fallback} />)
    expect(screen.getByText('Rendering diagram…')).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('[data-testid="diagram"]')).toBeInTheDocument())
    expect(initialize).toHaveBeenCalledWith({ startOnLoad: false, securityLevel: 'strict' })
    expect(mermaidRender).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-preview-/), 'graph TD; A-->B')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('falls back to raw diagram source when Mermaid rejects', async () => {
    mermaidRender.mockRejectedValueOnce(new Error('invalid'))
    const fallback = vi.fn()
    render(<MarkdownPreview content={'```mermaid\nbad graph\n```'} onFallback={fallback} />)
    await screen.findByText('bad graph')
    expect(screen.getByText('bad graph')).toHaveClass('markdown-mermaid-fallback')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('calls preview fallback when a Mermaid block exceeds the watchdog', async () => {
    vi.useFakeTimers()
    mermaidRender.mockImplementation(() => new Promise(() => {}))
    const fallback = vi.fn()
    render(<MarkdownPreview content={'```mermaid\ngraph TD\n```'} onFallback={fallback} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001) })
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('does not update a block or fire timeout after unmount', async () => {
    vi.useFakeTimers()
    let resolve: ((value: { svg: string }) => void) | undefined
    mermaidRender.mockImplementation(() => new Promise(r => { resolve = r }))
    const fallback = vi.fn()
    const view = render(<MarkdownPreview content={'```mermaid\ngraph TD\n```'} onFallback={fallback} />)
    view.unmount()
    await act(async () => { resolve?.({ svg: '<svg></svg>' }); await Promise.resolve(); await vi.advanceTimersByTimeAsync(10_001) })
    expect(fallback).not.toHaveBeenCalled()
  })

  it('routes React render failures through the error boundary', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    markdownThrows = true
    const fallback = vi.fn()
    const { container } = render(<MarkdownPreview content="boom" onFallback={fallback} />)
    await waitFor(() => expect(fallback).toHaveBeenCalledTimes(1))
    expect(container.querySelector('.markdown-preview')).toBeInTheDocument()
    expect(consoleError).toHaveBeenCalled()
  })
})
