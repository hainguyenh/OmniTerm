/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EditorTabHost } from '../EditorTabHost'
import { PreviewPane } from '../PreviewPane'

vi.mock('../../MarkdownPreview', () => ({
  default: ({ content }: { content: string }) => {
    if (content === 'boom') throw new Error('render failed')
    return <div data-testid="markdown">{content}</div>
  },
}))
vi.mock('../preview/SvgPreview', () => ({ SvgPreview: ({ text }: { text: string }) => <div data-testid="svg">{text}</div> }))
vi.mock('../preview/CsvPreview', () => ({ CsvPreview: ({ text }: { text: string }) => <div data-testid="csv">{text}</div> }))
vi.mock('../preview/JsonGraphPreview', () => ({
  JsonGraphPreview: ({ text, onReveal }: { text: string; onReveal: (offset: number) => void }) => (
    <button data-testid="json" onClick={() => onReveal(3)}>{text}</button>
  ),
}))
vi.mock('../FileEditorTab', () => ({
  FileEditorTab: (props: { onRun: () => void; onClose: () => void; onDirtyChange: (dirty: boolean) => void }) => (
    <div>
      <button onClick={props.onRun}>run</button>
      <button onClick={props.onClose}>close</button>
      <button onClick={() => props.onDirtyChange(true)}>dirty</button>
      <button onClick={() => props.onDirtyChange(false)}>clean</button>
    </div>
  ),
}))

/** A document whose text can be changed from the test, notifying subscribers like the real one. */
function fakeDoc(initial: string) {
  let text = initial
  const listeners = new Set<() => void>()
  return {
    getText: () => text,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next: string) {
      text = next
      listeners.forEach((listener) => listener())
    },
  }
}

const noop = () => {}

describe('PreviewPane', () => {
  it('re-renders the preview only after typing pauses, and only while visible', () => {
    vi.useFakeTimers()
    const doc = fakeDoc('# one')
    const { rerender } = render(<PreviewPane kind="markdown" doc={doc} visible fileName="a.md" onFallback={noop} onReveal={noop} />)
    expect(screen.getByTestId('markdown')).toHaveTextContent('# one')
    act(() => doc.set('# two'))
    expect(screen.getByTestId('markdown')).toHaveTextContent('# one')
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.getByTestId('markdown')).toHaveTextContent('# two')

    rerender(<PreviewPane kind="markdown" doc={doc} visible={false} fileName="a.md" onFallback={noop} onReveal={noop} />)
    act(() => doc.set('# hidden'))
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.getByTestId('markdown')).toHaveTextContent('# two')
    rerender(<PreviewPane kind="markdown" doc={doc} visible fileName="a.md" onFallback={noop} onReveal={noop} />)
    expect(screen.getByTestId('markdown')).toHaveTextContent('# hidden')
    vi.useRealTimers()
  })

  it('asks before rendering a large file and refuses an oversized one', () => {
    const large = fakeDoc('x'.repeat(2 * 1024 * 1024 + 10))
    render(<PreviewPane kind="markdown" doc={large} visible fileName="a.md" onFallback={noop} onReveal={noop} />)
    expect(screen.getByText(/may take a while/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Render anyway'))
    expect(screen.getByTestId('markdown')).toBeInTheDocument()

    const huge = fakeDoc('x'.repeat(6 * 1024 * 1024))
    render(<PreviewPane kind="markdown" doc={huge} visible fileName="b.md" onFallback={noop} onReveal={noop} />)
    expect(screen.getByText(/too large to preview \(6\.0 MB\)/)).toBeInTheDocument()
  })

  it('routes each kind to its preview and falls back when one throws', () => {
    const onReveal = vi.fn()
    render(<PreviewPane kind="html" doc={fakeDoc('<p>x</p>')} visible fileName="a.html" onFallback={noop} onReveal={noop} />)
    expect(screen.getByTitle('HTML preview')).toBeInTheDocument()
    render(<PreviewPane kind="csv" doc={fakeDoc('a,b')} visible fileName="a.csv" onFallback={noop} onReveal={noop} />)
    expect(screen.getByTestId('csv')).toHaveTextContent('a,b')
    render(<PreviewPane kind="json" doc={fakeDoc('{}')} visible fileName="a.json" onFallback={noop} onReveal={onReveal} />)
    fireEvent.click(screen.getByTestId('json'))
    expect(onReveal).toHaveBeenCalledWith(3)
    render(<PreviewPane kind="svg" doc={fakeDoc('<svg/>')} visible fileName="i.svg" onFallback={noop} onReveal={noop} />)
    expect(screen.getByTestId('svg')).toHaveTextContent('<svg/>')

    const onFallback = vi.fn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<PreviewPane kind="markdown" doc={fakeDoc('boom')} visible fileName="c.md" onFallback={onFallback} onReveal={noop} />)
    expect(onFallback).toHaveBeenCalledWith(expect.stringContaining('could not render'))
    error.mockRestore()
  })
})

describe('EditorTabHost', () => {
  it('binds the tab to the layout bookkeeping', async () => {
    const closeTab = vi.fn()
    const keepTab = vi.fn()
    const runScript = vi.fn()
    let dirty: Record<string, boolean> = {}
    const setEditorDirty = vi.fn((update: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => {
      dirty = typeof update === 'function' ? update(dirty) : update
    })
    const script = { id: 's', name: 'run.sh', path: 'f/run.sh', kind: 'sh' }
    render(<EditorTabHost tabId="t" editor={{ workspaceId: 'w', script }} visible closeTab={closeTab} keepTab={keepTab}
      runScript={runScript} setEditorDirty={setEditorDirty} />)
    fireEvent.click(await screen.findByText('run'))
    expect(keepTab).toHaveBeenCalledWith('t')
    expect(runScript).toHaveBeenCalledWith('w', script)
    fireEvent.click(screen.getByText('close'))
    expect(closeTab).toHaveBeenCalledWith('t')
    fireEvent.click(screen.getByText('dirty'))
    expect(dirty).toEqual({ t: true })
    const before = dirty
    fireEvent.click(screen.getByText('dirty'))
    expect(dirty).toBe(before)
    fireEvent.click(screen.getByText('clean'))
    expect(dirty).toEqual({ t: false })
    expect(keepTab).toHaveBeenCalledTimes(3)
  })
})
