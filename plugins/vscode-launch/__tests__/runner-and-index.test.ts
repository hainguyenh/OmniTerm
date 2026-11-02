import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import pluginModule, { activate, deactivate } from '../src/index'
import { createLaunchRunner } from '../src/runner'

const tempDirs: string[] = []
const testRunners: Array<ReturnType<typeof createLaunchRunner>> = []

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniterm-vscode-launch-t4-'))
  tempDirs.push(dir)
  return dir
}

function makeRunner(deps?: Parameters<typeof createLaunchRunner>[0]) {
  const runner = createLaunchRunner(deps)
  testRunners.push(runner)
  return runner
}

function waitUntil(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Timed out waiting for condition'))
        return
      }
      setTimeout(tick, 25)
    }
    tick()
  })
}

afterEach(async () => {
  await deactivate()
  while (testRunners.length > 0) {
    const r = testRunners.pop()
    if (r) await r.stopAll()
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('createLaunchRunner', () => {
  it('runs multiple launches via compound, streams logs with ring cap, forwards stdin, and stops cleanly', async () => {
    const repo = makeTempRepo()
    const echoScript = path.join(repo, 'echo-svc.cjs')
    fs.writeFileSync(
      echoScript,
      [
        'console.log("Listening on http://localhost:5123");',
        'console.error("Debugger listening on ws://127.0.0.1:9229/abc-123");',
        'process.stdin.setEncoding("utf8");',
        'process.stdin.on("data", (chunk) => console.log("ECHO:" + chunk.trim()));',
        'setInterval(() => {}, 1000);',
      ].join('\n'),
      'utf8',
    )
    const quickScript = path.join(repo, 'quick-svc.cjs')
    fs.writeFileSync(quickScript, 'for (let i = 0; i < 12; i++) console.log("line-" + i);', 'utf8')

    fs.mkdirSync(path.join(repo, '.vscode'), { recursive: true })
    fs.writeFileSync(
      path.join(repo, '.vscode', 'launch.json'),
      JSON.stringify({
        version: '0.2.0',
        configurations: [
          {
            name: 'Echo Server',
            type: 'node',
            request: 'launch',
            runtimeExecutable: process.execPath,
            program: echoScript,
          },
          {
            name: 'Quick Batch',
            type: 'node',
            request: 'launch',
            runtimeExecutable: process.execPath,
            program: quickScript,
          },
        ],
        compounds: [
          {
            name: 'Both',
            configurations: ['Echo Server', 'Quick Batch', 'Echo Server', 'Ghost Service'],
            stopAll: false,
          },
        ],
      }),
      'utf8',
    )

    const runner = createLaunchRunner({ maxLogLines: 8 })
    const started = await runner.start({
      rootDir: repo,
      compoundId: '.::compound::Both',
      mode: 'run',
    })

    expect(started).toHaveLength(2)
    const echoRun = started.find((r) => r.name === 'Echo Server')!
    const quickRun = started.find((r) => r.name === 'Quick Batch')!

    await waitUntil(() => {
      const current = runner.listRuns().find((r) => r.runId === echoRun.runId)
      return Boolean(current?.listeningUrls.includes('http://localhost:5123') && current.attach?.wsUrl)
    })

    const sent = runner.sendInput(echoRun.runId, 'ping-omni\n')
    expect(sent).toBe(true)

    await waitUntil(() => {
      const logs = runner.readLogs(echoRun.runId, 0)
      return logs.lines.some((l) => l.text.includes('ECHO:ping-omni'))
    })

    await waitUntil(() => {
      const q = runner.listRuns().find((r) => r.runId === quickRun.runId)
      return q?.status === 'exited'
    })

    const ringChunk = runner.readLogs(quickRun.runId, 0)
    expect(ringChunk.truncated).toBe(true)
    expect(ringChunk.lines.length).toBeLessThanOrEqual(8)

    const restarted = await runner.restart(echoRun.runId, 'run')
    expect(restarted.runId).not.toBe(echoRun.runId)

    const stopped = await runner.stopAll()
    expect(stopped.length).toBeGreaterThanOrEqual(1)
  })

  it('aborts main target launch when preLaunchTask fails and records task output', async () => {
    const repo = makeTempRepo()
    fs.mkdirSync(path.join(repo, '.vscode'), { recursive: true })
    fs.writeFileSync(
      path.join(repo, '.vscode', 'tasks.json'),
      JSON.stringify({
        version: '2.0.0',
        tasks: [
          {
            label: 'fail-build',
            type: 'process',
            command: process.execPath,
            args: ['-e', 'console.error("CS0103: build failed"); process.exit(2);'],
          },
        ],
      }),
      'utf8',
    )
    const markerFile = path.join(repo, 'should-not-exist.txt')
    fs.writeFileSync(
      path.join(repo, '.vscode', 'launch.json'),
      JSON.stringify({
        version: '0.2.0',
        configurations: [
          {
            name: 'App',
            type: 'node',
            request: 'launch',
            runtimeExecutable: process.execPath,
            args: ['-e', `require("fs").writeFileSync(${JSON.stringify(markerFile)}, "ran")`],
            preLaunchTask: 'fail-build',
          },
        ],
      }),
      'utf8',
    )

    const runner = createLaunchRunner()
    const [run] = await runner.start({
      rootDir: repo,
      configIds: ['.::App'],
      mode: 'run',
    })

    await waitUntil(() => runner.listRuns().find((r) => r.runId === run.runId)?.status === 'failed')
    expect(fs.existsSync(markerFile)).toBe(false)
    const logs = runner.readLogs(run.runId, 0)
    expect(logs.lines.some((l) => l.text.includes('CS0103: build failed'))).toBe(true)
    await runner.stopAll()
  })

  it('cascades compound stopAll peers, runs compound preLaunchTask, prunes retained runs, and reports ENOENT', async () => {
    const repo = makeTempRepo()
    fs.mkdirSync(path.join(repo, '.vscode'), { recursive: true })
    const longSvcA = path.join(repo, 'svc-a.cjs')
    const longSvcB = path.join(repo, 'svc-b.cjs')
    fs.writeFileSync(longSvcA, 'console.log("a-up"); setInterval(() => {}, 1000);', 'utf8')
    fs.writeFileSync(longSvcB, 'console.log("b-up"); setInterval(() => {}, 1000);', 'utf8')
    const prepMarker = path.join(repo, 'compound-prep.txt')
    fs.writeFileSync(
      path.join(repo, '.vscode', 'tasks.json'),
      JSON.stringify({
        version: '2.0.0',
        tasks: [
          {
            label: 'compound-prep',
            type: 'process',
            command: process.execPath,
            args: ['-e', `require("fs").writeFileSync(${JSON.stringify(prepMarker)}, "ok")`],
          },
        ],
      }),
      'utf8',
    )
    fs.writeFileSync(
      path.join(repo, '.vscode', 'launch.json'),
      JSON.stringify({
        version: '0.2.0',
        configurations: [
          { name: 'SvcA', type: 'node', request: 'launch', runtimeExecutable: process.execPath, program: longSvcA },
          { name: 'SvcB', type: 'node', request: 'launch', runtimeExecutable: process.execPath, program: longSvcB },
          {
            name: 'MissingBin',
            type: 'node',
            request: 'launch',
            runtimeExecutable: 'definitely-missing-omniterm-bin-xyz',
            program: longSvcA,
          },
        ],
        compounds: [
          {
            name: 'StopTogether',
            configurations: ['SvcA', 'SvcB'],
            preLaunchTask: 'compound-prep',
            stopAll: true,
          },
        ],
      }),
      'utf8',
    )

    const runner = makeRunner({ maxRetainedRuns: 2 })
    const started = await runner.start({ rootDir: repo, compoundId: '.::compound::StopTogether', mode: 'run' })
    expect(started).toHaveLength(2)
    await waitUntil(() => fs.existsSync(prepMarker))
    await waitUntil(() =>
      started.every((item) => runner.listRuns().find((r) => r.runId === item.runId)?.status === 'running'),
    )

    await runner.stop([started[0].runId])
    await waitUntil(() =>
      started.every((item) => {
        const s = runner.listRuns().find((r) => r.runId === item.runId)?.status
        return s === 'stopped' || s === 'exited'
      }),
    )

    const [missingRun] = await runner.start({ rootDir: repo, configIds: ['.::MissingBin'], mode: 'run' })
    await waitUntil(() => runner.listRuns().find((r) => r.runId === missingRun.runId)?.status === 'failed')
    const failedSnap = runner.listRuns().find((r) => r.runId === missingRun.runId)!
    expect(failedSnap.error).toBeTruthy()
    expect(runner.listRuns().length).toBeLessThanOrEqual(2)
  })
})

describe('sidecar activate / IPC boundary validation', () => {
  it('registers vscodeLaunch.* RPC methods and rejects untrusted inputs', async () => {
    let registered: ((method: string, ...args: unknown[]) => unknown) | null = null
    const logs: string[] = []
    activate({
      registerInvokeHandler: (handler) => {
        registered = handler
      },
      services: {
        log: (msg) => logs.push(msg),
        writeClipboard: async () => {},
      },
    })

    expect(pluginModule.name).toBe('@omniterm/vscode-launch')
    expect(registered).not.toBeNull()
    expect(logs.some((m) => m.includes('activated'))).toBe(true)

    const info = (await registered!('vscodeLaunch.info')) as { name: string }
    expect(info.name).toBe('VS Code Launch Runner')

    const repo = makeTempRepo()
    const discovered = (await registered!('vscodeLaunch.discover', repo)) as { files: unknown[] }
    expect(discovered.files).toEqual([])

    expect(() => registered!('vscodeLaunch.discover', 'bad\0path')).toThrow()
    expect(() => registered!('vscodeLaunch.start', { rootDir: repo, mode: 'invalid-mode' })).toThrow(/Invalid launch mode/)
    expect(() => registered!('vscodeLaunch.stop', { runIds: 'not-array' })).toThrow(/Invalid runIds/)
    expect(() => registered!('vscodeLaunch.stop', { runIds: [''] })).toThrow(/Invalid item in runIds/)
    expect(() => registered!('vscodeLaunch.restart', { runId: '' })).toThrow(/Invalid runId/)
    expect(() => registered!('vscodeLaunch.readLogs', { runId: '' })).toThrow(/Invalid runId/)
    expect(() => registered!('vscodeLaunch.sendInput', { runId: '' })).toThrow(/Invalid runId/)
    expect(() => registered!('vscodeLaunch.sendInput', { runId: 'r1', data: 123 })).toThrow(/Invalid input data/)

    // Valid end-to-end RPC cycle through index.ts
    fs.mkdirSync(path.join(repo, '.vscode'), { recursive: true })
    const svcPath = path.join(repo, 'rpc-svc.cjs')
    fs.writeFileSync(svcPath, 'console.log("rpc-ready"); setInterval(() => {}, 1000);', 'utf8')
    fs.writeFileSync(
      path.join(repo, '.vscode', 'tasks.json'),
      JSON.stringify({
        version: '2.0.0',
        tasks: [{ label: 'prep', type: 'process', command: process.execPath, args: ['-e', 'console.log("prep-ok")'] }],
      }),
      'utf8',
    )
    fs.writeFileSync(
      path.join(repo, '.vscode', 'launch.json'),
      JSON.stringify({
        version: '0.2.0',
        configurations: [
          {
            name: 'RpcSvc',
            type: 'node',
            request: 'launch',
            runtimeExecutable: process.execPath,
            program: svcPath,
            preLaunchTask: 'prep',
          },
        ],
      }),
      'utf8',
    )

    const started = (await registered!('vscodeLaunch.start', {
      rootDir: repo,
      configIds: ['.::RpcSvc'],
      mode: 'debug',
    })) as Array<{ runId: string }>
    expect(started).toHaveLength(1)
    const runId = started[0].runId

    await waitUntil(() => {
      const chunk = registered!('vscodeLaunch.readLogs', { runId, afterSeq: 0 }) as { lines: Array<{ text: string }> }
      return chunk.lines.some((l) => l.text.includes('rpc-ready'))
    })

    const sendRes = registered!('vscodeLaunch.sendInput', { runId, data: 'hi\n' }) as { ok: boolean }
    expect(sendRes.ok).toBe(true)

    const listed = registered!('vscodeLaunch.listRuns') as Array<{ runId: string }>
    expect(listed.some((r) => r.runId === runId)).toBe(true)

    const restarted = (await registered!('vscodeLaunch.restart', { runId, mode: 'run' })) as { runId: string }
    expect(restarted.runId).toBeTruthy()

    const missingOpen = (await registered!('vscodeLaunch.openInEditor', {
      folderPath: path.join(repo, 'does-not-exist'),
      editor: 'codium',
    })) as { ok: boolean }
    expect(missingOpen.ok).toBe(false)

    const fileOpen = (await registered!('vscodeLaunch.openInEditor', {
      folderPath: svcPath,
      editor: 'codium',
    })) as { ok: boolean; message?: string }
    expect(fileOpen.ok).toBe(false)
    expect(fileOpen.message).toMatch(/directory/)

    const stopRoot = (await registered!('vscodeLaunch.stop', { allInRoot: repo })) as { stopped: string[] }
    expect(Array.isArray(stopRoot.stopped)).toBe(true)

    const stopAll = (await registered!('vscodeLaunch.stop', { all: true })) as { stopped: string[] }
    expect(Array.isArray(stopAll.stopped)).toBe(true)

    await expect(
      Promise.resolve().then(() =>
        registered!('vscodeLaunch.start', {
          rootDir: repo,
          configIds: ['.::NonExistent'],
          mode: 'run',
        }),
      ),
    ).rejects.toThrow()
    expect(() => registered!('otherPlugin.method')).toThrow(/Unknown vscode-launch method/)
  })
})
