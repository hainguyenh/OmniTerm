/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleCsvRequest } from '../csvParse'
import { HtmlPreview } from '../HtmlPreview'
import { PREVIEW_CSP, withPreviewCsp } from '../htmlPreviewCsp'
import { handleJsonGraphRequest } from '../jsonGraphTask'

// Run worker jobs synchronously through the main-thread fallback.
vi.mock('../editorWorkers', () => ({
  createCsvWorker: () => { throw new Error('no workers in tests') },
  createJsonGraphWorker: () => { throw new Error('no workers in tests') },
}))

import { CsvPreview } from '../CsvPreview'
import { JsonGraphPreview } from '../JsonGraphPreview'

function sizeViewport(width: number, height: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height })
}

beforeEach(() => sizeViewport(800, 240))

describe('HtmlPreview', () => {
  it('renders into a script-less sandbox with a network-free CSP', () => {
    render(<HtmlPreview html="<html><head><title>t</title></head><body><p>Hi</p></body></html>" />)
    const frame = screen.getByTitle('HTML preview')
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('srcdoc')).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`)
  })

  it('prepends the CSP when there is no head', () => {
    expect(withPreviewCsp('<p>x</p>')).toMatch(/^<meta http-equiv="Content-Security-Policy"/)
    expect(withPreviewCsp('<HEAD lang="en"><x>')).toContain('<HEAD lang="en"><meta')
  })
})

describe('CsvPreview', () => {
  it('renders only the visible rows, with an optional header row', () => {
    const text = ['name,qty', ...Array.from({ length: 1000 }, (_, index) => `item${index},${index}`)].join('\n')
    render(<CsvPreview text={text} fileName="stock.csv" />)
    expect(screen.getByText('1,000 rows × 2 columns')).toBeInTheDocument()
    expect(screen.getByText('name')).toBeInTheDocument()
    expect(screen.getByText('item0')).toBeInTheDocument()
    expect(screen.queryByText('item500')).toBeNull()
    expect(document.querySelectorAll('.csv-row').length).toBeLessThan(40)

    fireEvent.click(screen.getByLabelText('First row is header'))
    expect(screen.getByText('1,001 rows × 2 columns')).toBeInTheDocument()
  })

  it('reports unterminated quotes and long cells', () => {
    render(<CsvPreview text={`a,"open\n${'x'.repeat(600)},b`} fileName="bad.csv" />)
    expect(screen.getByText(/never closed/)).toBeInTheDocument()
    expect(handleCsvRequest({ text: 'a', fileName: 'a.csv' }).result.rowCount).toBe(1)
  })
})

describe('JsonGraphPreview', () => {
  it('draws nodes, toggles collapse and supports zoom and pan', async () => {
    render(<JsonGraphPreview text={JSON.stringify({ a: 1, child: { b: [1, 2] } })} onReveal={vi.fn()} />)
    await act(async () => { await new Promise((done) => requestAnimationFrame(() => done(null))) })
    expect(screen.getByText('root {2}')).toBeInTheDocument()
    expect(screen.getByText('child {1}')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Collapse child {1}'))
    expect(screen.queryByText('b [2]')).toBeNull()
    fireEvent.click(screen.getByLabelText('Expand all'))
    expect(screen.getByText('b [2]')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Collapse all'))
    expect(screen.queryByText('b [2]')).toBeNull()

    const zoom = () => screen.getByText(/%$/).textContent
    const before = zoom()
    fireEvent.click(screen.getByLabelText('Zoom in'))
    await act(async () => { await new Promise((done) => requestAnimationFrame(() => done(null))) })
    expect(zoom()).not.toBe(before)
    fireEvent.click(screen.getByLabelText('Fit to view'))
    expect(zoom()).toBe(before)

    const canvas = document.querySelector('.json-graph') as HTMLElement
    const wheel = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true })
    canvas.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, bubbles: true, cancelable: true }))
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 30, clientY: 40 })
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 0, clientY: 0 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    await act(async () => { await new Promise((done) => requestAnimationFrame(() => done(null))) })
    expect(zoom()).not.toBe(before)
  })

  it('shows where invalid JSON broke and jumps there', () => {
    const onReveal = vi.fn()
    render(<JsonGraphPreview text={'{"a": }'} onReveal={onReveal} />)
    expect(screen.getByText(/Invalid JSON \(line 1/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Go to error'))
    expect(onReveal).toHaveBeenCalledWith(6)
    expect(handleJsonGraphRequest({ text: '[]', collapsed: [] }).result.ok).toBe(true)
  })

  it('draws plain boxes when zoomed far out and flags truncated graphs', () => {
    sizeViewport(100, 100)
    // 50 × 50 nested objects: past the node cap even though each level is under the child cap.
    const big = Array.from({ length: 50 }, () => Array.from({ length: 50 }, (_, index) => ({ index })))
    render(<JsonGraphPreview text={JSON.stringify(big)} onReveal={vi.fn()} />)
    expect(screen.getByText(/showing the first/)).toBeInTheDocument()
    expect(document.querySelector('.json-graph-node')).not.toBeNull()
    expect(document.querySelector('.json-graph-title')).toBeNull()
  })
})
