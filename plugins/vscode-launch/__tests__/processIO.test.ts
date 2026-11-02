import { PassThrough } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  executePreTask,
  extractLineTelemetry,
  killProcessTree,
  pipeStreamLines,
  spawnSafe,
} from '../src/processIO'

describe('processIO helpers', () => {
  it('extractLineTelemetry collects up to 6 unique listening URLs and parses ws:// inspector URLs', () => {
    const urls: string[] = []
    let attach = extractLineTelemetry(
      'Ready at http://localhost:3000 and https://127.0.0.1:8443/api and http://localhost:3000',
      urls,
      undefined,
    )
    expect(urls).toEqual(['http://localhost:3000', 'https://127.0.0.1:8443/api'])
    expect(attach).toBeUndefined()

    attach = extractLineTelemetry(
      'Debugger listening on ws://127.0.0.1:9229/1111-2222',
      urls,
      undefined,
    )
    expect(attach).toEqual({
      kind: 'node-inspector',
      wsUrl: 'ws://127.0.0.1:9229/1111-2222',
    })
  })

  it('pipeStreamLines handles null streams, chunk splits, and trailing remainder on end', async () => {
    const collected: string[] = []
    pipeStreamLines(null, (l) => collected.push(l))
    expect(collected).toEqual([])

    const stream = new PassThrough()
    pipeStreamLines(stream, (l) => collected.push(l))
    stream.write('first ')
    stream.write(Buffer.from('line\r\nsecond\npartial'))
    stream.end()
    stream.resume()
    await new Promise<void>((resolve) => stream.once('end', () => resolve()))
    expect(collected).toEqual(['first line', 'second', 'partial'])
  })

  it('spawnSafe wraps useShell commands safely with spaces and quotes without shell:true', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniterm-procio- '))
    try {
      const script = path.join(dir, 'echo args.cjs')
      fs.writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)));', 'utf8')
      const lines: string[] = []
      const child = spawnSafe(process.execPath, [script, '', 'a "quoted" space val'], {
        cwd: dir,
        useShell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      pipeStreamLines(child.stdout, (l) => lines.push(l))
      await new Promise<void>((resolve) => child.once('close', () => resolve()))
      expect(JSON.parse(lines[0])).toEqual(['', 'a "quoted" space val'])

      // Calling killProcessTree on an already-exited child resolves immediately
      await killProcessTree(child)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('executePreTask handles stopping state and missing binary errors gracefully', async () => {
    const logs: string[] = []
    const okMissing = await executePreTask({
      task: {
        label: 'missing',
        command: 'nonexistent-omniterm-pretask-xyz',
        args: [],
        cwd: os.tmpdir(),
        shell: false,
      },
      extraEnv: {},
      isStopping: () => false,
      setChild: () => {},
      onLog: (_s, t) => logs.push(t),
    })
    expect(okMissing).toBe(false)
    expect(logs.some((l) => l.includes('preLaunchTask'))).toBe(true)

    const okStopped = await executePreTask({
      task: {
        label: 'quick',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd: os.tmpdir(),
        shell: false,
      },
      extraEnv: {},
      isStopping: () => true,
      setChild: () => {},
      onLog: () => {},
    })
    expect(okStopped).toBe(false)
  })

  it('executePreTask unblocks immediately when background task prints ready pattern', async () => {
    const logs: string[] = []
    let childRef: any = null
    const ok = await executePreTask({
      task: {
        label: 'npm: watch',
        command: process.execPath,
        args: [
          '-e',
          'console.log("Starting compilation in watch mode..."); console.log("Found 0 errors. Watching for file changes."); setInterval(() => {}, 1000);',
        ],
        cwd: os.tmpdir(),
        shell: false,
        isBackground: true,
        readyPattern: 'watching for file changes',
      },
      extraEnv: {},
      isStopping: () => false,
      setChild: (c) => {
        childRef = c
      },
      onLog: (_s, t) => logs.push(t),
    })

    expect(ok).toBe(true)
    expect(logs.some((l) => l.includes('is ready'))).toBe(true)
    if (childRef) await killProcessTree(childRef)
  })
})
