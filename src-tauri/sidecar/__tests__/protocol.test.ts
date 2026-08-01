import { PassThrough } from 'node:stream'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require_ = createRequire(import.meta.url)
interface ProtocolOptions {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  onParseError?: (error: unknown, line: string) => void
}
interface Protocol {
  pendingRequests: Map<number, unknown>
  onNotification: (handler: (method: string, params: unknown) => void) => void
  onRequest: (handler: (method: string, params: unknown) => unknown) => void
  sendNotification: (method: string, params: unknown) => void
  sendResponse: (id: number, result?: unknown, error?: unknown) => void
  callRemote: (method: string, params: unknown) => Promise<unknown>
  _handleMessage: (message: unknown) => Promise<void>
}
const { JsonRpcProtocol } = require_('../protocol.cjs') as {
  JsonRpcProtocol: new (options?: ProtocolOptions) => Protocol
}

function harness() {
  const input = new PassThrough()
  const output = new PassThrough()
  const writes: string[] = []
  output.setEncoding('utf8')
  output.on('data', (chunk: string) => writes.push(chunk))
  return {
    input,
    writes,
    protocol: new JsonRpcProtocol({ input, output }),
    messages: () => writes.join('').trim().split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

describe('JsonRpcProtocol', () => {
  it('sends notifications and successful or failed responses', () => {
    const { protocol, messages } = harness()
    protocol.sendNotification('session.changed', { id: 's1' })
    protocol.sendResponse(4, undefined)
    protocol.sendResponse(5, null, 'boom')
    protocol.sendResponse(6, null, { code: 42, message: 'custom' })

    expect(messages()).toEqual([
      { jsonrpc: '2.0', method: 'session.changed', params: { id: 's1' } },
      { jsonrpc: '2.0', id: 4, result: null },
      { jsonrpc: '2.0', id: 5, error: { code: -32603, message: 'boom' } },
      { jsonrpc: '2.0', id: 6, error: { code: 42, message: 'custom' } },
    ])
  })

  it('correlates remote calls with success and error responses', async () => {
    const { protocol, messages } = harness()
    const success = protocol.callRemote('plugin.list', { enabled: true })
    const failure = protocol.callRemote('plugin.load', { id: 'bad' })

    expect(messages()).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'plugin.list', params: { enabled: true } },
      { jsonrpc: '2.0', id: 2, method: 'plugin.load', params: { id: 'bad' } },
    ])
    await protocol._handleMessage({ jsonrpc: '2.0', id: 1, result: ['a'] })
    await protocol._handleMessage({ jsonrpc: '2.0', id: 2, error: { message: 'denied' } })

    await expect(success).resolves.toEqual(['a'])
    await expect(failure).rejects.toThrow('denied')
    expect(protocol.pendingRequests.size).toBe(0)
  })

  it('handles incoming requests and converts thrown values into RPC errors', async () => {
    const { protocol, messages } = harness()
    protocol.onRequest(async (method, params) => {
      if (method === 'fail') throw new Error('request failed')
      return { method, params }
    })

    await protocol._handleMessage({ jsonrpc: '2.0', id: 8, method: 'ok', params: { n: 1 } })
    await protocol._handleMessage({ jsonrpc: '2.0', id: 9, method: 'fail' })

    expect(messages()).toEqual([
      { jsonrpc: '2.0', id: 8, result: { method: 'ok', params: { n: 1 } } },
      { jsonrpc: '2.0', id: 9, error: { code: -32603, message: 'request failed' } },
    ])
  })

  it('rejects incoming requests when no handler is registered', async () => {
    const { protocol, messages } = harness()
    await protocol._handleMessage({ jsonrpc: '2.0', id: 3, method: 'missing' })
    expect(messages()[0]).toEqual({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32603, message: 'Method "missing" not found' },
    })
  })

  it('delivers notifications and ignores invalid or unknown responses', async () => {
    const { protocol, writes } = harness()
    const received: unknown[] = []
    protocol.onNotification((method, params) => received.push({ method, params }))

    await protocol._handleMessage(null)
    await protocol._handleMessage('not-an-object')
    await protocol._handleMessage({ jsonrpc: '2.0', id: 999, result: 'orphan' })
    await protocol._handleMessage({ jsonrpc: '2.0', method: 'ready', params: { ok: true } })

    expect(received).toEqual([{ method: 'ready', params: { ok: true } }])
    expect(writes).toEqual([])
  })

  it('parses line-delimited input and reports malformed JSON without crashing', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const onParseError = vi.fn()
    const protocol = new JsonRpcProtocol({ input, output, onParseError })
    const received: unknown[] = []
    protocol.onNotification((method, params) => received.push({ method, params }))

    input.write('   \n')
    input.write('{bad json\n')
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'ready', params: 7 })}\n`)
    await new Promise((resolve) => setImmediate(resolve))

    expect(onParseError).toHaveBeenCalledOnce()
    expect(received).toEqual([{ method: 'ready', params: 7 }])
  })
})
