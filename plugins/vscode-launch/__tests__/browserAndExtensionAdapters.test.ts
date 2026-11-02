import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isBrowserLaunchType,
  isExtensionHostLaunchType,
  synthesizeBrowserLaunch,
  synthesizeExtensionHostLaunch,
} from '../src/browserAndExtensionAdapters'
import { formatTerminalCommand } from '../src/terminalCommand'
import type { LaunchConfigItem } from '../src/types'
import { createDefaultVariableContext } from '../src/variables'

describe('browserAndExtensionAdapters', () => {
  const tmpDir = path.join(os.tmpdir(), `omniterm-test-browser-${Date.now()}`)
  const ctx = createDefaultVariableContext(tmpDir)

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
    vi.restoreAllMocks()
  })

  it('correctly classifies browser and extension host launch types', () => {
    expect(isBrowserLaunchType('chrome')).toBe(true)
    expect(isBrowserLaunchType('pwa-chrome')).toBe(true)
    expect(isBrowserLaunchType('msedge')).toBe(true)
    expect(isBrowserLaunchType('pwa-msedge')).toBe(true)
    expect(isBrowserLaunchType('edge')).toBe(true)
    expect(isBrowserLaunchType('firefox')).toBe(true)
    expect(isBrowserLaunchType('CHROME')).toBe(true)
    expect(isBrowserLaunchType('node')).toBe(false)
    expect(isBrowserLaunchType('coreclr')).toBe(false)

    expect(isExtensionHostLaunchType('extensionHost')).toBe(true)
    expect(isExtensionHostLaunchType('extension-host')).toBe(true)
    expect(isExtensionHostLaunchType('vscode-extension')).toBe(true)
    expect(isExtensionHostLaunchType('EXTENSIONHOST')).toBe(true)
    expect(isExtensionHostLaunchType('node')).toBe(false)
  })

  it('synthesizes browser launch for Chrome in run and debug modes', () => {
    const config: LaunchConfigItem = {
      id: 'test::chrome',
      name: 'Launch Chrome',
      type: 'chrome',
      request: 'launch',
      runnable: true,
      workspaceFolder: tmpDir,
      relativeFolder: '.',
      url: 'http://localhost:3000',
    }

    const runLaunch = synthesizeBrowserLaunch({
      config,
      mode: 'run',
      ctx,
      userArgs: ['--incognito'],
      runtimeArgs: ['--no-first-run'],
      cwd: tmpDir,
      envOverrides: {},
      baseEnv: {},
      preTask: null,
    })

    expect(runLaunch.args).toContain('http://localhost:3000')
    expect(runLaunch.args).toContain('--incognito')
    expect(runLaunch.args).toContain('--no-first-run')
    expect(runLaunch.args.some((a) => a.includes('remote-debugging-port'))).toBe(false)
    expect(runLaunch.attach?.note).toContain('Google Chrome')

    const debugLaunch = synthesizeBrowserLaunch({
      config,
      mode: 'debug',
      ctx,
      userArgs: [],
      runtimeArgs: [],
      cwd: tmpDir,
      envOverrides: {},
      baseEnv: {},
      preTask: null,
    })

    expect(debugLaunch.args).toContain('--remote-debugging-port=9222')
    expect(debugLaunch.attach?.note).toContain('remote debugging on :9222')

    const customPortLaunch = synthesizeBrowserLaunch({
      config,
      mode: 'debug',
      ctx,
      userArgs: ['--remote-debugging-port=9333'],
      runtimeArgs: [],
      cwd: tmpDir,
      envOverrides: {},
      baseEnv: {},
      preTask: null,
    })
    expect(customPortLaunch.args.filter((a) => a.includes('remote-debugging-port'))).toEqual([
      '--remote-debugging-port=9333',
    ])
  })

  it('synthesizes browser launch for Edge and Firefox', () => {
    const edgeConfig: LaunchConfigItem = {
      id: 'test::edge',
      name: 'Launch Edge',
      type: 'msedge',
      request: 'launch',
      runnable: true,
      workspaceFolder: tmpDir,
      relativeFolder: '.',
    }

    const edgeLaunch = synthesizeBrowserLaunch({
      config: edgeConfig,
      mode: 'run',
      ctx,
      userArgs: [],
      runtimeArgs: [],
      cwd: tmpDir,
      envOverrides: {},
      baseEnv: {},
      preTask: null,
    })
    expect(edgeLaunch.attach?.note).toContain('Microsoft Edge')

    const firefoxConfig: LaunchConfigItem = {
      id: 'test::firefox',
      name: 'Launch Firefox',
      type: 'firefox',
      request: 'launch',
      runnable: true,
      workspaceFolder: tmpDir,
      relativeFolder: '.',
    }

    const ffLaunch = synthesizeBrowserLaunch({
      config: firefoxConfig,
      mode: 'debug',
      ctx,
      userArgs: [],
      runtimeArgs: [],
      cwd: tmpDir,
      envOverrides: {},
      baseEnv: {},
      preTask: null,
    })
    expect(ffLaunch.args.some((a) => a.includes('remote-debugging-port'))).toBe(false)
    expect(ffLaunch.attach?.note).toContain('Firefox')
  })

  it('handles platform-specific browser executable resolution (darwin and linux)', () => {
    const originalPlatform = process.platform

    try {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const macLaunch = synthesizeBrowserLaunch({
        config: {
          id: 'test::mac-chrome',
          name: 'Mac Chrome',
          type: 'chrome',
          request: 'launch',
          runnable: true,
          workspaceFolder: tmpDir,
          relativeFolder: '.',
        },
        mode: 'run',
        ctx,
        userArgs: [],
        runtimeArgs: [],
        cwd: tmpDir,
        envOverrides: {},
        baseEnv: {},
        preTask: null,
      })
      expect(macLaunch.command).toBeTruthy()

      Object.defineProperty(process, 'platform', { value: 'linux' })
      const linuxEdgeLaunch = synthesizeBrowserLaunch({
        config: {
          id: 'test::linux-edge',
          name: 'Linux Edge',
          type: 'msedge',
          request: 'launch',
          runnable: true,
          workspaceFolder: tmpDir,
          relativeFolder: '.',
        },
        mode: 'run',
        ctx,
        userArgs: [],
        runtimeArgs: [],
        cwd: tmpDir,
        envOverrides: {},
        baseEnv: {},
        preTask: null,
      })
      expect(linuxEdgeLaunch.command).toBe('microsoft-edge')

      const linuxFfLaunch = synthesizeBrowserLaunch({
        config: {
          id: 'test::linux-ff',
          name: 'Linux FF',
          type: 'firefox',
          request: 'launch',
          runnable: true,
          workspaceFolder: tmpDir,
          relativeFolder: '.',
        },
        mode: 'run',
        ctx,
        userArgs: [],
        runtimeArgs: [],
        cwd: tmpDir,
        envOverrides: {},
        baseEnv: {},
        preTask: null,
      })
      expect(linuxFfLaunch.command).toBe('firefox')
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('respects explicit runtimeExecutable in browser launches', () => {
    const customBin = path.join(tmpDir, 'custom-browser.exe')
    const config: LaunchConfigItem = {
      id: 'test::custom-browser',
      name: 'Custom Browser',
      type: 'chrome',
      request: 'launch',
      runnable: true,
      workspaceFolder: tmpDir,
      relativeFolder: '.',
      runtimeExecutable: customBin,
    }

    const launch = synthesizeBrowserLaunch({
      config,
      mode: 'run',
      ctx,
      userArgs: [],
      runtimeArgs: [],
      runtimeExecutable: customBin,
      cwd: tmpDir,
      envOverrides: {},
      baseEnv: {},
      preTask: null,
    })

    expect(launch.command).toBe(customBin)
  })

  it('synthesizes extensionHost launch preferring VSCodium when requested', () => {
    const config: LaunchConfigItem = {
      id: 'test::extHost',
      name: 'Launch Extension',
      type: 'extensionHost',
      request: 'launch',
      runnable: true,
      workspaceFolder: tmpDir,
      relativeFolder: '.',
      runtimeExecutable: '${execPath}',
      args: ['--disable-extensions'],
    }

    const codiumLaunch = synthesizeExtensionHostLaunch({
      config,
      mode: 'debug',
      userArgs: ['--disable-extensions'],
      runtimeArgs: ['--verbose'],
      runtimeExecutable: 'codium',
      cwd: tmpDir,
      envOverrides: { MY_ENV: '1' },
      baseEnv: {},
      preTask: null,
      deps: { editors: ['codium'] },
    })

    expect(codiumLaunch.command).toMatch(/codium/i)
    expect(codiumLaunch.args).toContain(`--extensionDevelopmentPath=${tmpDir}`)
    expect(codiumLaunch.args).toContain('--disable-extensions')
    expect(codiumLaunch.args).toContain('--verbose')
    expect(codiumLaunch.attach?.note).toContain('VSCodium (debug mode)')
  })

  it('synthesizes extensionHost launch with VS Code and explicit custom binary', () => {
    const config: LaunchConfigItem = {
      id: 'test::extHost-code',
      name: 'Launch in VS Code',
      type: 'extensionHost',
      request: 'launch',
      runnable: true,
      workspaceFolder: tmpDir,
      relativeFolder: '.',
      runtimeExecutable: '/opt/custom/code-bin',
      args: [`--extensionDevelopmentPath=${tmpDir}`],
    }

    const launch = synthesizeExtensionHostLaunch({
      config,
      mode: 'run',
      userArgs: [`--extensionDevelopmentPath=${tmpDir}`],
      runtimeArgs: [],
      runtimeExecutable: '/opt/custom/code-bin',
      cwd: tmpDir,
      envOverrides: {},
      baseEnv: {},
      preTask: null,
      deps: { editors: ['code'] },
    })

    expect(launch.command).toBe('/opt/custom/code-bin')
    expect(launch.args.filter((a) => a.startsWith('--extensionDevelopmentPath='))).toHaveLength(1)
    expect(launch.attach?.note).toContain('VS Code')
  })

  it('normalizes win32 extension development paths and formats terminal commands', () => {
    const originalPlatform = process.platform
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      const winLaunch = synthesizeExtensionHostLaunch({
        config: {
          id: 'test::win-ext',
          name: 'Win Ext',
          type: 'extensionHost',
          request: 'launch',
          runnable: true,
          workspaceFolder: 'C:\\Users\\test\\my-extension',
          relativeFolder: '.',
        },
        mode: 'run',
        userArgs: ['--extensionDevelopmentPath=C:/Users/test/my-extension'],
        runtimeArgs: [],
        cwd: 'C:\\Users\\test\\my-extension',
        envOverrides: {},
        baseEnv: {},
        preTask: null,
        deps: { editors: ['code'] },
      })
      expect(winLaunch.args).toContain(`--extensionDevelopmentPath=${path.normalize('C:/Users/test/my-extension')}`)
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }

    // Terminal command formatting
    expect(formatTerminalCommand('node', ['run.js', 'a b'], 'win32')).toBe("node run.js 'a b'")
    expect(formatTerminalCommand('C:\\bin\\tool.cmd', ['run.js', 'a b'], 'win32')).toBe('C:\\bin\\tool.cmd run.js "a b"')
    expect(formatTerminalCommand('C:\\Program Files\\app.exe', ['run'], 'win32')).toBe("& 'C:\\Program Files\\app.exe' run")
    expect(formatTerminalCommand('node', ['entry with space.js'], 'linux')).toBe("node 'entry with space.js'")
  })
})
