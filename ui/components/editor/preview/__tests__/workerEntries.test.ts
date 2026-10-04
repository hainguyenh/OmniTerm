/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('worker entries', () => {
  it('answer CSV requests with a transferred row index', async () => {
    const postMessage = vi.fn()
    vi.stubGlobal('postMessage', postMessage)
    await import('../csv.worker')
    window.dispatchEvent(new MessageEvent('message', { data: { id: 1, payload: { text: 'a,b\n1,2', fileName: 'x.csv' } } }))
    const [message, options] = postMessage.mock.calls[0]
    expect(message).toMatchObject({ id: 1, ok: true, result: { rowCount: 2 } })
    expect(options.transfer).toEqual([message.result.rowStarts.buffer])
  })

  it('answer JSON graph requests', async () => {
    const postMessage = vi.fn()
    vi.stubGlobal('postMessage', postMessage)
    await import('../jsonGraph.worker')
    window.dispatchEvent(new MessageEvent('message', { data: { id: 2, payload: { text: '{"a":{}}', collapsed: [] } } }))
    // Both entry modules share this test window, so the CSV listener answers (with an error) too.
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, ok: true, result: expect.objectContaining({ ok: true }) }),
      { transfer: [] },
    )
  })

  it('are constructed as module workers from the app origin', async () => {
    const constructed: [URL, WorkerOptions | undefined][] = []
    vi.stubGlobal('Worker', class {
      constructor(url: URL, options?: WorkerOptions) {
        constructed.push([url, options])
      }
    })
    const { createCsvWorker, createJsonGraphWorker } = await import('../editorWorkers')
    createCsvWorker()
    createJsonGraphWorker()
    expect(constructed.map(([url]) => String(url))).toEqual([
      expect.stringContaining('csv.worker'), expect.stringContaining('jsonGraph.worker'),
    ])
    expect(constructed.every(([, options]) => options?.type === 'module')).toBe(true)
  })
})
