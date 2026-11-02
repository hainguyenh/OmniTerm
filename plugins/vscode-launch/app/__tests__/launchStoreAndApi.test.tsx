/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AnsiLine } from '../ansiOutput'
import { stripAnsi } from '../ansiParser'
import {
  closeConsole,
  closeTargetConsole,
  ensureDiscovered,
  getLaunchState,
  openConsoleForRun,
  registerLaunchApi,
  resetLaunchStore,
  restartRun,
  setConsoleHeight,
  setDefaultLaunchMode,
  setLaunchAvailable,
  setRunsSnapshot,
  startCompound,
  startConfigs,
  stopAllInRoot,
  stopRuns,
  toggleSelectedConfig,
} from '../launchStore'
import { createVsCodeLaunchAPI } from '../vscodeLaunchAPI'

describe('createVsCodeLaunchAPI', () => {
  it('validates RPC responses and gracefully handles malformed or rejected calls', async () => {
    const mockInvoke = vi.fn(async (method: string, payload?: unknown) => {
      if (method === 'vscodeLaunch.info') return { name: 'VS Code Launch Runner', editors: ['codium', 'invalid'] }
      if (method === 'vscodeLaunch.discover') {
        return {
          rootDir: String(payload),
          editors: ['codium'],
          files: [
            {
              launchJsonPath: '/repo/.vscode/launch.json',
              workspaceFolder: '/repo',
              relativeFolder: '.',
              version: '0.2.0',
              configurations: [
                {
                  id: '.::API',
                  name: 'API',
                  type: 'coreclr',
                  request: 'launch',
                  runnable: true,
                  workspaceFolder: '/repo',
                  relativeFolder: '.',
                },
              ],
            },
          ],
          compounds: [
            {
              id: '.::compound::All',
              name: 'All',
              relativeFolder: '.',
              workspaceFolder: '/repo',
              configIds: ['.::API'],
              missingTargets: [],
              stopAll: true,
            },
          ],
        }
      }
      if (method === 'vscodeLaunch.listRuns') {
        return [
          {
            runId: 'run-1',
            configId: '.::API',
            name: 'API',
            type: 'coreclr',
            mode: 'debug',
            status: 'running',
            rootDir: '/repo',
            workspaceFolder: '/repo',
            relativeFolder: '.',
            cwd: '/repo',
            terminalCommand: 'dotnet Api.dll',
            pid: 9001,
            startedAt: 100,
            listeningUrls: ['http://localhost:5000'],
            attach: { kind: 'netcoredbg-server', host: '127.0.0.1', port: 4711, pid: 9001 },
          },
          { malformed: true },
        ]
      }
      if (method === 'vscodeLaunch.readLogs') {
        return {
          runId: 'run-1',
          nextSeq: 2,
          truncated: false,
          lines: [{ seq: 1, stream: 'stdout', text: 'ready', timestamp: 101 }],
        }
      }
      if (method === 'vscodeLaunch.start') {
        return [
          {
            runId: 'run-started',
            configId: '.::API',
            name: 'API',
            type: 'coreclr',
            mode: 'run',
            status: 'running',
            rootDir: '/repo',
            workspaceFolder: '/repo',
            relativeFolder: '.',
            cwd: '/repo',
            terminalCommand: 'dotnet Api.dll',
            startedAt: 105,
            listeningUrls: [],
          },
        ]
      }
      if (method === 'vscodeLaunch.stop') return { stopped: ['run-1'] }
      if (method === 'vscodeLaunch.removeRun') return { ok: true }
      if (method === 'vscodeLaunch.restart') {
        return {
          runId: 'run-2',
          configId: '.::API',
          name: 'API',
          type: 'coreclr',
          mode: 'debug',
          status: 'running',
          rootDir: '/repo',
          workspaceFolder: '/repo',
          relativeFolder: '.',
          cwd: '/repo',
          terminalCommand: 'dotnet Api.dll',
          startedAt: 110,
          listeningUrls: [],
        }
      }
      if (method === 'vscodeLaunch.sendInput') return { ok: true }
      if (method === 'vscodeLaunch.openInEditor') return { ok: true, editor: 'codium', message: 'opened' }
      throw new Error('offline')
    })

    const api = createVsCodeLaunchAPI(mockInvoke)
    const info = await api.info()
    expect(info).toEqual({ available: true, editors: ['codium'] })

    const disc = await api.discover('/repo')
    expect(disc.files).toHaveLength(1)
    expect(disc.compounds).toHaveLength(1)

    const runs = await api.listRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0].attach?.port).toBe(4711)

    const logs = await api.readLogs('run-1', 0)
    expect(logs.lines[0].text).toBe('ready')

    const opened = await api.openInEditor('/repo', 'codium')
    expect(opened.ok).toBe(true)

    const started = await api.start({ rootDir: '/repo', configIds: ['.::API'], mode: 'run' })
    expect(started).toHaveLength(1)
    expect(await api.stop(['run-1'])).toEqual(['run-1'])
    expect(await api.stopInRoot('/repo')).toEqual(['run-1'])
    expect(await api.removeRun('run-1')).toBe(true)
    expect((await api.restart('run-1', 'debug'))?.runId).toBe('run-2')
    expect(await api.sendInput('run-1', 'x\n')).toBe(true)

    const brokenApi = createVsCodeLaunchAPI(async () => {
      throw new Error('sidecar down')
    })
    expect(await brokenApi.info()).toEqual({ available: false, editors: [] })
    expect((await brokenApi.discover('/repo')).files).toEqual([])
    expect(await brokenApi.listRuns()).toEqual([])
    expect(await brokenApi.stop(['run-1'])).toEqual([])
    expect(await brokenApi.stopInRoot('/repo')).toEqual([])
    expect(await brokenApi.removeRun('run-1')).toBe(false)
    expect(await brokenApi.restart('run-1')).toBeNull()
    expect((await brokenApi.readLogs('run-1', 5)).nextSeq).toBe(5)
    expect(await brokenApi.sendInput('run-1', 'x')).toBe(false)
    expect((await brokenApi.openInEditor('/repo')).ok).toBe(false)

    const malformedApi = createVsCodeLaunchAPI(async () => 'not-an-object')
    expect(await malformedApi.info()).toEqual({ available: false, editors: [] })
    expect((await malformedApi.discover('/repo')).files).toEqual([])
    expect(await malformedApi.start({ rootDir: '/repo', mode: 'run' })).toEqual([])
    expect(await malformedApi.stop(['run-1'])).toEqual([])
    expect(await malformedApi.stopInRoot('/repo')).toEqual([])
    expect((await malformedApi.readLogs('run-1', 3)).lines).toEqual([])
    expect((await malformedApi.openInEditor('/repo')).ok).toBe(false)
  })
})

describe('launchStore', () => {
  beforeEach(() => {
    resetLaunchStore()
  })

  it('caches discoveries, tracks multi-select per folder, starts configs, and manages console drawer', async () => {
    const discoverSpy = vi.fn(async (rootDir: string) => ({
      rootDir,
      editors: ['codium' as const],
      compounds: [],
      files: [
        {
          launchJsonPath: `${rootDir}/.vscode/launch.json`,
          workspaceFolder: rootDir,
          relativeFolder: '.',
          version: '0.2.0',
          configurations: [
            {
              id: '.::SvcA',
              name: 'SvcA',
              type: 'node',
              request: 'launch',
              runnable: true,
              workspaceFolder: rootDir,
              relativeFolder: '.',
            },
          ],
        },
      ],
    }))

    const startSpy = vi.fn(async () => [
      {
        runId: 'r-10',
        configId: '.::SvcA',
        name: 'SvcA',
        type: 'node',
        mode: 'run' as const,
        status: 'running' as const,
        rootDir: '/repo',
        workspaceFolder: '/repo',
        relativeFolder: '.',
        cwd: '/repo',
        terminalCommand: 'node index.js',
        startedAt: 1000,
        listeningUrls: [],
      },
    ])

    const stopSpy = vi.fn().mockResolvedValue([])
    registerLaunchApi({
      info: async () => ({ available: true, editors: ['codium'] }),
      discover: discoverSpy,
      start: startSpy,
      stop: stopSpy,
      stopInRoot: async () => [],
      removeRun: async () => true,
      restart: async () => {
        throw new Error('unused')
      },
      listRuns: async () => [],
      readLogs: async (runId, afterSeq) => ({ runId, lines: [], nextSeq: afterSeq, truncated: false }),
      sendInput: async () => true,
      openInEditor: async () => ({ ok: true }),
      openUrl: async () => true,
    })

    setLaunchAvailable(true, ['codium'])
    await Promise.all([ensureDiscovered('/repo'), ensureDiscovered('/repo')])
    expect(discoverSpy).toHaveBeenCalledTimes(1)

    toggleSelectedConfig('/repo', '.::SvcA')
    expect(getLaunchState().selectedByRoot['/repo']).toEqual(['.::SvcA'])
    toggleSelectedConfig('/repo', '.::SvcA')
    expect(getLaunchState().selectedByRoot['/repo']).toEqual([])
    toggleSelectedConfig('/repo', '.::SvcA')

    setDefaultLaunchMode('debug')
    expect(getLaunchState().defaultMode).toBe('debug')

    await startConfigs('/repo', ['.::SvcA'], 'run')
    expect(getLaunchState().runs).toHaveLength(1)

    await startCompound('/repo', '.::compound::All', 'debug')
    await stopRuns(['r-10'])
    await stopAllInRoot('/repo')

    // Newly failed run auto-opens console drawer
    setRunsSnapshot([
      {
        runId: 'r-fail',
        configId: '.::SvcA',
        name: 'SvcA',
        type: 'node',
        mode: 'run',
        status: 'failed',
        rootDir: '/repo',
        workspaceFolder: '/repo',
        relativeFolder: '.',
        cwd: '/repo',
        terminalCommand: 'node index.js',
        startedAt: 2000,
        listeningUrls: [],
        error: 'Exit 1',
      },
    ])
    expect(getLaunchState().consoleOpen).toBe(true)
    expect(getLaunchState().activeRunId).toBe('r-fail')

    openConsoleForRun('r-fail')
    setConsoleHeight(9999)
    expect(getLaunchState().consoleHeight).toBeLessThanOrEqual(720)
    closeConsole()
    expect(getLaunchState().consoleOpen).toBe(false)

    // Close target run permanently
    setRunsSnapshot([
      {
        runId: 'r-1',
        configId: '.::A',
        name: 'A',
        type: 'node',
        mode: 'run',
        status: 'running',
        rootDir: '/repo',
        workspaceFolder: '/repo',
        relativeFolder: '.',
        cwd: '/repo',
        terminalCommand: 'node a.js',
        startedAt: 100,
        listeningUrls: [],
      },
      {
        runId: 'r-2',
        configId: '.::B',
        name: 'B',
        type: 'node',
        mode: 'run',
        status: 'running',
        rootDir: '/repo',
        workspaceFolder: '/repo',
        relativeFolder: '.',
        cwd: '/repo',
        terminalCommand: 'node b.js',
        startedAt: 100,
        listeningUrls: [],
      },
    ])
    openConsoleForRun('r-1')
    expect(getLaunchState().activeRunId).toBe('r-1')
    await closeTargetConsole('r-1')
    expect(stopSpy).toHaveBeenCalledWith(['r-1'])
    expect(getLaunchState().runs.map((r) => r.runId)).toEqual(['r-2'])
    expect(getLaunchState().activeRunId).toBe('r-2')
    expect(getLaunchState().consoleOpen).toBe(true)

    await closeTargetConsole('r-2')
    expect(getLaunchState().runs).toHaveLength(0)
    expect(getLaunchState().consoleOpen).toBe(false)

    // Verify subsequent snapshot cannot restore dismissed runs
    setRunsSnapshot([
      {
        runId: 'r-1',
        configId: '.::A',
        name: 'A',
        type: 'node',
        mode: 'run',
        status: 'failed',
        rootDir: '/repo',
        workspaceFolder: '/repo',
        relativeFolder: '.',
        cwd: '/repo',
        terminalCommand: 'node a.js',
        startedAt: 100,
        listeningUrls: [],
      },
    ])
    expect(getLaunchState().runs).toHaveLength(0)
    expect(getLaunchState().consoleOpen).toBe(false)

    // Error handling when start fails
    registerLaunchApi({
      info: async () => ({ available: true, editors: [] }),
      discover: discoverSpy,
      start: async () => {
        throw new Error('spawn failed')
      },
      stop: async () => [],
      stopInRoot: async () => [],
      removeRun: async () => true,
      restart: async () => ({
        runId: 'r-restarted',
        configId: '.::SvcA',
        name: 'SvcA',
        type: 'node',
        mode: 'run',
        status: 'running',
        rootDir: '/repo',
        workspaceFolder: '/repo',
        relativeFolder: '.',
        cwd: '/repo',
        terminalCommand: 'node index.js',
        startedAt: 3000,
        listeningUrls: [],
      }),
      listRuns: async () => [],
      readLogs: async (runId, afterSeq) => ({ runId, lines: [], nextSeq: afterSeq, truncated: false }),
      sendInput: async () => true,
      openInEditor: async () => ({ ok: true }),
      openUrl: async () => true,
    })
    await startConfigs('/repo', ['.::SvcA'], 'run')
    expect(getLaunchState().lastError).toBe('spawn failed')
    await startCompound('/repo', '.::compound::All', 'run')
    expect(getLaunchState().lastError).toBe('spawn failed')
    await restartRun('r-fail', 'run')
    expect(getLaunchState().activeRunId).toBe('r-restarted')
  })
})

describe('AnsiLine and stripAnsi', () => {
  it('renders SGR color/bold/dim/reset spans and strips non-SGR CSI and OSC sequences', () => {
    const raw = '\x1b]0;Window Title\x07\x1b[2K\x1b[1;31mFATAL\x1b[22;39m \x1b[2;96mdetail\x1b[0m plain'
    expect(stripAnsi(raw)).toBe('FATAL detail plain')

    render(<AnsiLine text={raw} />)
    const fatal = screen.getByText('FATAL')
    expect(fatal.className).toContain('font-semibold')
    expect(screen.getByText('detail').className).toContain('opacity-70')
    expect(screen.getByText(/plain/)).toBeInTheDocument()
    render(<AnsiLine text="" />)
  })
})
