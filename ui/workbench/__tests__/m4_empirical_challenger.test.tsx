/**
 * @vitest-environment jsdom
 */
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ide/features/debugger/ui/DebugToolWindow', () => ({
  DebugToolWindow: () => <div data-testid="upstream-debug-tool-window">Upstream Debug View</div>,
  DebugTabs: () => <div data-testid="upstream-debug-tabs">Upstream Debug Tabs</div>,
}))

vi.mock('../../ide/features/run/RunView', () => ({
  RunView: () => <div data-testid="upstream-run-view">Upstream Run View</div>,
  RunTabs: () => <div data-testid="upstream-run-tabs">Upstream Run Tabs</div>,
}))

import { useDebug, type DebugSession } from '../../ide/features/debugger/state'
import { useRun } from '../../ide/features/run/store'
import { executeAction, registerActions } from '../../ide/platform/actions'
import { activateWorkbenchFeatures } from '../activateWorkbenchFeatures'
import { DebuggerToolWindow } from '../debugger/DebuggerToolWindow'
import { registerDebuggerWorkbench } from '../debugger/registerDebuggerWorkbench'
import { RunConsoleToolWindow } from '../run/RunConsoleToolWindow'
import { registerRunWorkbench } from '../run/registerRunWorkbench'
import {
  createScriptRunConfig,
  discoverWorkspaceScripts,
  getScriptType,
  isScriptPath,
} from '../run/scriptRunProducer'
import { createSessionsHost } from '../sessionsHostCore'
import { useShellPanels } from '../shellPanelsStore'

describe('Empirical Challenger M4: Adversarial Stress & Confinement Suite', () => {
  const disposers: Array<() => void> = []

  beforeEach(() => {
    act(() => {
      useRun.setState({
        configs: [],
        selectedId: null,
        sessions: [],
        activeSession: null,
        versions: {},
      })
      useDebug.setState({
        sessions: {},
        active: null,
      })
      useShellPanels.setState({
        sessions: null,
        bookmarks: null,
      })
    })
  })

  afterEach(() => {
    while (disposers.length > 0) {
      try {
        disposers.pop()?.()
      } catch {
        // Safe cleanup
      }
    }
    vi.restoreAllMocks()
    act(() => {
      useRun.setState({ sessions: [], configs: [] })
      useDebug.setState({ sessions: {} })
    })
  })

  describe('Adversarial Challenge 1: Script Execution Edge Cases', () => {
    it('handles paths with spaces, unicode, quotes, and special characters', () => {
      const edgePaths = [
        'C:\\Program Files (x86)\\My App\\scripts\\start server.ps1',
        '/var/opt/my company/tools/build & deploy.sh',
        'D:\\workspace\\project-1\\scripts\\run_job#1 [test].cmd',
        'relative path/with spaces/run test.bat',
        '/home/user/project/unicode_тест_файл.sh',
      ]

      for (const scriptPath of edgePaths) {
        expect(isScriptPath(scriptPath)).toBe(true)
        const config = createScriptRunConfig({ path: scriptPath })
        expect(config.kind).toBe('shell')
        expect(config.id).toBe(`omniterm:script:${scriptPath.replace(/\\/g, '/')}`)
        expect(config.args).toContain(scriptPath)
      }
    })

    it('rigorously tests script type classification and case-insensitivity', () => {
      // Supported variants
      expect(getScriptType('run.PS1')).toBe('ps1')
      expect(getScriptType('build.BAT')).toBe('bat')
      expect(getScriptType('start.CMD')).toBe('cmd')
      expect(getScriptType('script.SH')).toBe('sh')
      expect(getScriptType('test.BASH')).toBe('sh')
      expect(getScriptType('eval.ZSH')).toBe('sh')

      // Unsupported or deceptive extensions
      expect(isScriptPath('script.ps1.bak')).toBe(false)
      expect(getScriptType('script.ps1.bak')).toBeNull()
      expect(isScriptPath('script.bat.exe')).toBe(false)
      expect(isScriptPath('readme.sh.txt')).toBe(false)
      expect(isScriptPath('main.py')).toBe(false)
      expect(isScriptPath('app.js')).toBe(false)
      expect(isScriptPath('Dockerfile')).toBe(false)
      expect(isScriptPath('')).toBe(false)
      expect(isScriptPath('   ')).toBe(false)
    })

    it('safely preserves arguments with shell metacharacters as distinct array elements', () => {
      const maliciousArgs = [
        '; rm -rf /',
        '$(whoami)',
        '`calc.exe`',
        '| echo injected',
        '&& format C:',
        '--flag="with quotes and spaces"',
        'arg with \n newline and \t tabs',
      ]

      const config = createScriptRunConfig({
        path: '/workspace/script.sh',
        args: maliciousArgs,
      })

      // The args array must preserve them as discrete entries, not concatenated into a raw shell string
      expect(config.args.slice(1)).toEqual(maliciousArgs)
      expect(config.command).toBeDefined()
    })

    it('correctly handles boundary dirname scenarios', () => {
      // Relative single-file without slash
      const config1 = createScriptRunConfig({ path: 'local_run.sh' })
      expect(config1.cwd).toBeNull()
      expect(config1.name).toBe('local_run.sh')

      // Absolute Unix root
      const config2 = createScriptRunConfig({ path: '/root_run.sh' })
      expect(config2.cwd).toBeNull()
      expect(config2.name).toBe('root_run.sh')

      // Nested Unix
      const config3 = createScriptRunConfig({ path: '/home/dev/tool.sh' })
      expect(config3.cwd).toBe('/home/dev')
      expect(config3.name).toBe('tool.sh')

      // Nested Windows with backslashes
      const config4 = createScriptRunConfig({ path: 'C:\\projects\\app\\test.ps1' })
      expect(config4.cwd).toBe('C:/projects/app')
      expect(config4.name).toBe('test.ps1')
    })
  })

  describe('Adversarial Challenge 2: Workspace Script Discovery & Confinement', () => {
    it('discovers only supported runnable scripts and skips directories or unrelated files', () => {
      const entries = [
        { path: 'src/index.ts', isDir: false },
        { path: 'scripts/build.sh', isDir: false },
        { path: 'scripts/test.ps1', isDir: false },
        { path: 'scripts/run.cmd', isDir: false },
        { path: 'scripts/subfolder.sh', isDir: true }, // directory named .sh
        { path: 'tools/setup.bat', isDir: false },
        { path: 'package.json', isDir: false },
        { path: 'notes.md', isDir: false },
      ]

      const configs = discoverWorkspaceScripts(entries, { cwd: '/workspace' })
      expect(configs).toHaveLength(4)
      expect(configs.map((c) => c.name)).toEqual([
        'build.sh',
        'test.ps1',
        'run.cmd',
        'setup.bat',
      ])
      for (const config of configs) {
        expect(config.cwd).toBe('/workspace')
        expect(config.detected).toBe(true)
        expect(config.kind).toBe('shell')
      }
    })

    it('handles empty workspace entries safely without errors', () => {
      const configs = discoverWorkspaceScripts([])
      expect(configs).toEqual([])
    })
  })

  describe('Adversarial Challenge 3: Terminal Session Complete Isolation', () => {
    it('guarantees active PTY sessions in SessionsHostContext are 100% unaffected by heavy run/debug activity', () => {
      // 1. Mount persistent PTY session host
      const host = createSessionsHost()
      const container = document.createElement('div')
      container.appendChild(host)
      document.body.appendChild(container)

      const terminalTabProps = {
        tabs: [
          { id: 'pty-sess-1', title: 'zsh' },
          { id: 'pty-sess-2', title: 'ssh remote' },
        ],
        activeTab: 'pty-sess-1',
      }

      act(() => {
        useShellPanels.setState({
          sessions: terminalTabProps as never,
          bookmarks: null,
        })
      })

      // Ensure PTY terminal is attached
      expect(container.contains(host)).toBe(true)
      expect(useShellPanels.getState().sessions).toEqual(terminalTabProps)

      // 2. Activate workbench features
      const releaseWorkbench = activateWorkbenchFeatures()
      disposers.push(releaseWorkbench)

      // 3. Flood run store with 200 sessions and heavy stdout version increments
      act(() => {
        for (let i = 0; i < 200; i++) {
          const cfg = createScriptRunConfig({ path: `/repo/task_${i}.sh` })
          useRun.setState((s) => ({
            configs: [...s.configs, cfg],
            sessions: [
              ...s.sessions,
              {
                id: `sess-${i}`,
                runId: i,
                config: cfg,
                status: 'running',
                startedAt: Date.now(),
                endedAt: null,
                stdinClosed: false,
                exitCode: null,
                stopped: false,
              },
            ],
            activeSession: `sess-${i}`,
            versions: { ...s.versions, [`sess-${i}`]: i * 5 },
          }))
        }
      })

      // 4. Flood debugger store with 50 sessions and various states
      act(() => {
        for (let i = 1; i <= 50; i++) {
          const session = {
            id: i,
            name: `Debug-${i}`,
            adapter: 'node-debug2',
            status: i % 2 === 0 ? 'paused' : 'running',
            startedAt: Date.now(),
            threads: [{ id: 1, name: 'Main' }],
            frames: [{ id: 100 + i, name: 'entry', path: `/src/app_${i}.ts`, line: i, column: 1, presentationHint: null }],
            scopes: {},
            variables: {},
            capabilities: {},
            output: [],
          } as unknown as DebugSession
          useDebug.setState((s) => ({
            sessions: { ...s.sessions, [i]: session },
            active: i,
          }))
        }
      })

      // 5. Mount and unmount RunConsoleToolWindow and DebuggerToolWindow while active
      const runView = render(<RunConsoleToolWindow />)
      expect(runView.getByTestId('run-console-tool-window')).toBeDefined()
      runView.unmount()

      const debugView = render(<DebuggerToolWindow />)
      expect(debugView.getByTestId('debugger-tool-window')).toBeDefined()
      debugView.unmount()

      // 6. VERIFY: PTY terminal host DOM node has NEVER been touched, detached, or recreated
      expect(container.contains(host)).toBe(true)
      expect(host.dataset.sessionsHost).toBe('')
      expect(useShellPanels.getState().sessions).toEqual(terminalTabProps)
      expect(useShellPanels.getState().sessions?.tabs).toHaveLength(2)

      // Clean up DOM container
      document.body.removeChild(container)
    })

    it('workbench run/debug actions do not collide with shell/pty registrations', async () => {
      const executedBaseActions: string[] = []
      const unregisterBase = registerActions([
        { id: 'debug.stepOver', title: 'Step Over', run: () => { executedBaseActions.push('debug.stepOver') } },
        { id: 'debug.stepInto', title: 'Step Into', run: () => { executedBaseActions.push('debug.stepInto') } },
        { id: 'debug.resume', title: 'Resume', run: () => { executedBaseActions.push('debug.resume') } },
        { id: 'debug.stop', title: 'Stop', run: () => { executedBaseActions.push('debug.stop') } },
      ])
      disposers.push(unregisterBase)

      const disposeRun = registerRunWorkbench()
      const disposeDebug = registerDebuggerWorkbench()
      disposers.push(disposeRun, disposeDebug)

      // Execute run and debug actions
      await executeAction('workbench.debug.stepOver')
      await executeAction('workbench.debug.stepInto')
      await executeAction('workbench.debug.resume')
      await executeAction('workbench.debug.stop')

      expect(executedBaseActions).toEqual([
        'debug.stepOver',
        'debug.stepInto',
        'debug.resume',
        'debug.stop',
      ])

      // Ensure useShellPanels remains completely untouched
      expect(useShellPanels.getState().sessions).toBeNull()
      expect(useShellPanels.getState().bookmarks).toBeNull()
    })
  })
})
