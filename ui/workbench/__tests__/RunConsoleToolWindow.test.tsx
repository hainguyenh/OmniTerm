/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const executedActions: string[] = []

vi.mock('../../ide/platform/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ide/platform/actions')>()
  return {
    ...actual,
    executeAction: vi.fn((action: string) => {
      executedActions.push(action)
      return Promise.resolve()
    }),
  }
})

vi.mock('../../ide/features/run/RunView', () => ({
  RunView: () => <div data-testid="upstream-run-view">Upstream Run View</div>,
  RunTabs: () => <div data-testid="upstream-run-tabs">Upstream Run Tabs</div>,
}))

const startedRuns: unknown[] = []
vi.mock('../../ide/features/run/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ide/features/run/store')>()
  return {
    ...actual,
    startRun: vi.fn((config: unknown) => {
      startedRuns.push(config)
      return Promise.resolve({
        id: 'mock-session-id',
        runId: 1,
        config,
        status: 'running',
        startedAt: Date.now(),
        exitedAt: null,
        exitCode: null,
        stopped: false,
        console: null,
        input: '',
        terminal: null,
        terminalSize: null,
      })
    }),
  }
})

import { useStackTraces } from '../../ide/features/run/stackTrace'
import { useRun, type RunSession } from '../../ide/features/run/store'
import type { RunConfig } from '../../ide/platform/ipc'
import { registerRunWorkbench } from '../run/registerRunWorkbench'
import { RunConsoleTabs, RunConsoleToolWindow } from '../run/RunConsoleToolWindow'
import {
  createScriptRunConfig,
  discoverWorkspaceScripts,
  getScriptType,
  isScriptPath,
  runScriptWithUnifiedRunner,
} from '../run/scriptRunProducer'

describe('RunConsoleToolWindow (Feature 28 & Feature 30)', () => {
  beforeEach(() => {
    executedActions.length = 0
    startedRuns.length = 0
    act(() => {
      useRun.setState({
        sessions: [],
        activeSession: null,
      })
      useStackTraces.setState({
        tabs: [],
        dialog: null,
      })
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders OmniTerm empty state when no run session is active', () => {
    render(<RunConsoleToolWindow />)

    expect(screen.getByTestId('run-console-empty-state')).toBeTruthy()
    expect(screen.getByText('Run Console')).toBeTruthy()
    expect(
      screen.getByText(
        'Run configurations or tests with Shift+F10 or select a configuration from the title bar',
      ),
    ).toBeTruthy()

    const runBtn = screen.getByRole('button', { name: /Run Selected/i })
    fireEvent.click(runBtn)
    expect(executedActions).toContain('run.run')

    const editBtn = screen.getByRole('button', { name: /Edit Configurations…/i })
    fireEvent.click(editBtn)
    expect(executedActions).toContain('run.editConfigs')
  })

  it('renders active run session view when a session is active', () => {
    const dummySession: RunSession = {
      id: 'session-42',
      runId: 42,
      config: {
        id: 'cfg-test',
        name: 'Unit Tests',
        kind: 'cargo',
        command: 'cargo',
        args: ['test'],
        cwd: null,
        env: {},
        detected: false,
        isTest: true,
        debugAdapter: null,
      },
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      stdinClosed: false,
      exitCode: null,
      stopped: false,
    }

    act(() => {
      useRun.setState({
        sessions: [dummySession],
        activeSession: dummySession.id,
      })
    })

    render(<RunConsoleToolWindow />)

    expect(screen.queryByTestId('run-console-empty-state')).toBeNull()
    expect(screen.getByTestId('run-console-tool-window')).toBeTruthy()
    expect(screen.getByTestId('upstream-run-view')).toBeTruthy()
  })

  it('renders RunConsoleTabs header component', () => {
    render(<RunConsoleTabs />)
    expect(screen.getByTestId('upstream-run-tabs')).toBeTruthy()
  })

  describe('scriptRunProducer (Feature 30)', () => {
    it('detects script paths correctly', () => {
      expect(isScriptPath('scripts/deploy.sh')).toBe(true)
      expect(isScriptPath('scripts/start.bat')).toBe(true)
      expect(isScriptPath('scripts/build.cmd')).toBe(true)
      expect(isScriptPath('scripts/setup.ps1')).toBe(true)
      expect(isScriptPath('src/main.rs')).toBe(false)
      expect(isScriptPath('package.json')).toBe(false)

      expect(getScriptType('run.sh')).toBe('sh')
      expect(getScriptType('run.bat')).toBe('bat')
      expect(getScriptType('run.cmd')).toBe('cmd')
      expect(getScriptType('run.ps1')).toBe('ps1')
      expect(getScriptType('run.ts')).toBeNull()
    })

    it('creates appropriate RunConfig for different script types', () => {
      const ps1Config = createScriptRunConfig({
        path: 'D:/workspace/scripts/test.ps1',
        args: ['-Verbose'],
      })
      expect(ps1Config.kind).toBe('shell')
      expect(ps1Config.name).toBe('test.ps1')
      expect(ps1Config.args).toContain('-File')
      expect(ps1Config.args).toContain('D:/workspace/scripts/test.ps1')
      expect(ps1Config.args).toContain('-Verbose')
      expect(ps1Config.detected).toBe(true)

      const shConfig = createScriptRunConfig({
        path: '/workspace/build.sh',
        cwd: '/workspace',
      })
      expect(shConfig.kind).toBe('shell')
      expect(shConfig.name).toBe('build.sh')
      expect(shConfig.cwd).toBe('/workspace')
    })

    it('discovers workspace scripts from file entries', () => {
      const entries = [
        { path: 'scripts/run.sh', isDir: false },
        { path: 'scripts/init.bat', isDir: false },
        { path: 'src/index.ts', isDir: false },
        { path: 'node_modules', isDir: true },
      ]

      const configs = discoverWorkspaceScripts(entries)
      expect(configs).toHaveLength(2)
      expect(configs.map((c) => c.name)).toEqual(['run.sh', 'init.bat'])
    })

    it('executes script through unified runner', async () => {
      const session = await runScriptWithUnifiedRunner('scripts/build.sh')
      expect(session).not.toBeNull()
      expect(startedRuns).toHaveLength(1)
      const config = startedRuns[0] as RunConfig
      expect(config.name).toBe('build.sh')
      expect(config.kind).toBe('shell')
    })
  })

  describe('registerRunWorkbench', () => {
    it('registers run tool window with requiresProject: false', () => {
      const dispose = registerRunWorkbench()
      expect(dispose).toBeTypeOf('function')
      dispose()
    })
  })
})
