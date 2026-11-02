import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { formatTerminalCommand, synthesizeLaunchCommand } from '../src/adapters'
import {
  allocateLoopbackPort,
  buildNetCoreDbgAttachSnippet,
  detectInstalledEditors,
  findNetCoreDbg,
} from '../src/netcoredbg'
import type { LaunchConfigItem } from '../src/types'

const tempDirs: string[] = []

function makeTempDir(prefix = 'omniterm-vscode-launch-t3-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('netcoredbg and VSCodium discovery', () => {
  it('discovers netcoredbg inside VSCodium ~/.vscode-oss/extensions even with spaces in path', () => {
    const fakeHome = makeTempDir('codium home ')
    const binName = process.platform === 'win32' ? 'netcoredbg.exe' : 'netcoredbg'
    const extBinDir = path.join(fakeHome, '.vscode-oss', 'extensions', 'muhammad-sammy.csharp-2.40.0', 'debugger')
    fs.mkdirSync(extBinDir, { recursive: true })
    const expectedBin = path.join(extBinDir, binName)
    fs.writeFileSync(expectedBin, 'stub', 'utf8')

    const found = findNetCoreDbg({
      env: {},
      homeDir: fakeHome,
      platform: process.platform,
    })
    expect(found).toBe(expectedBin)
  })

  it('prefers NETCOREDBG_PATH when explicitly configured', () => {
    const dir = makeTempDir()
    const customBin = path.join(dir, 'custom-netcoredbg')
    fs.writeFileSync(customBin, 'stub', 'utf8')

    expect(findNetCoreDbg({ env: { NETCOREDBG_PATH: customBin }, homeDir: dir })).toBe(customBin)
  })

  it('detects codium first alongside code on PATH', () => {
    const binDir = makeTempDir()
    const ext = process.platform === 'win32' ? '.cmd' : ''
    fs.writeFileSync(path.join(binDir, `codium${ext}`), 'echo codium', 'utf8')
    fs.writeFileSync(path.join(binDir, `code${ext}`), 'echo code', 'utf8')

    const editors = detectInstalledEditors({
      env: { PATH: binDir },
      homeDir: binDir,
      platform: process.platform,
    })
    expect(editors).toEqual(['codium', 'code'])
  })

  it('allocates a valid ephemeral loopback port and builds VSCodium attach JSON', async () => {
    const port = await allocateLoopbackPort()
    expect(port).toBeGreaterThan(0)

    const serverSnippet = buildNetCoreDbgAttachSnippet({
      name: 'Auth API',
      port,
      pid: 4242,
      editor: 'codium',
      stopAtEntry: true,
    })
    expect(serverSnippet).toContain('"type": "netcoredbg"')
    expect(serverSnippet).toContain('"request": "attach"')
    expect(serverSnippet).toContain(String(port))
    expect(serverSnippet).toContain('"stopAtEntry": true')
    expect(serverSnippet).not.toContain('processId')

    const pidSnippet = buildNetCoreDbgAttachSnippet({
      name: 'Auth API',
      pid: 4242,
      editor: 'code',
    })
    expect(pidSnippet).toContain('"type": "coreclr"')
    expect(pidSnippet).toContain('"processId": "4242"')
    expect(pidSnippet).not.toContain('debugServer')
  })

  it('formats PowerShell and POSIX terminal commands safely with spaces and metacharacters', () => {
    const winCmd = formatTerminalCommand(
      'C:\\Users\\Alice Smith\\.vscode-oss\\extensions\\netcoredbg.exe',
      ['--server=4711', '--', 'dotnet', 'C:\\Repo\\Api$(whoami).dll'],
      'win32',
    )
    expect(winCmd.startsWith("& 'C:\\Users\\Alice Smith\\.vscode-oss\\extensions\\netcoredbg.exe'")).toBe(true)
    expect(winCmd).toContain("'C:\\Repo\\Api$(whoami).dll'")

    const posixCmd = formatTerminalCommand(
      '/Users/Alice Smith/bin/netcoredbg',
      ['--arg', "it's $(safe)"],
      'darwin',
    )
    expect(posixCmd.startsWith("'/Users/Alice Smith/bin/netcoredbg'")).toBe(true)
    expect(posixCmd).toContain("'it'\\''s $(safe)'")
  })
})

describe('synthesizeLaunchCommand', () => {
  it('synthesizes .NET Run Without Debugging with automatic build pre-step when DLL is missing', async () => {
    const ws = path.join(makeTempDir('My Dotnet Repo '), 'Api Service')
    fs.mkdirSync(ws, { recursive: true })
    fs.writeFileSync(path.join(ws, 'Api.csproj'), '<Project />', 'utf8')

    const cfg: LaunchConfigItem = {
      id: '.::Api',
      name: 'Api',
      type: 'coreclr',
      request: 'launch',
      runnable: true,
      workspaceFolder: ws,
      relativeFolder: '.',
      program: '${workspaceFolder}/bin/Debug/net8.0/Api.dll',
      args: ['--urls', 'http://localhost:5000'],
    }

    const synth = await synthesizeLaunchCommand(cfg, 'run', {
      allocatePort: async () => 4711,
      netcoredbgPath: null,
      editors: ['codium'],
    })

    expect(synth.command).toBe('dotnet')
    expect(synth.args).toEqual([path.join(ws, 'bin/Debug/net8.0/Api.dll'), '--urls', 'http://localhost:5000'])
    expect(synth.preTask?.command).toBe('dotnet')
    expect(synth.preTask?.args).toEqual(['build'])
    expect(synth.terminalCommand).toContain('Api.dll')
  })

  it('synthesizes .NET Debug Mode using netcoredbg --server for VSCodium', async () => {
    const ws = makeTempDir()
    const dllDir = path.join(ws, 'bin', 'Debug', 'net8.0')
    fs.mkdirSync(dllDir, { recursive: true })
    const dllPath = path.join(dllDir, 'Api.dll')
    fs.writeFileSync(dllPath, '', 'utf8')

    const cfg: LaunchConfigItem = {
      id: '.::Api',
      name: 'Api',
      type: 'netcoredbg',
      request: 'launch',
      runnable: true,
      workspaceFolder: ws,
      relativeFolder: '.',
      program: dllPath,
      args: ['--port', '5001'],
    }

    const synth = await synthesizeLaunchCommand(cfg, 'debug', {
      allocatePort: async () => 4712,
      netcoredbgPath: '/opt/netcoredbg/netcoredbg',
      editors: ['codium'],
    })

    expect(synth.command).toBe('/opt/netcoredbg/netcoredbg')
    expect(synth.args).toEqual([
      '--interpreter=vscode',
      '--server=4712',
      '--',
      'dotnet',
      dllPath,
      '--port',
      '5001',
    ])
    expect(synth.env.ASPNETCORE_ENVIRONMENT).toBe('Development')
    expect(synth.attach).toMatchObject({
      kind: 'netcoredbg-server',
      host: '127.0.0.1',
      port: 4712,
    })
    expect(synth.attach?.attachJson).toContain('"netcoredbg"')
  })

  it('degrades gracefully to dotnet PID-attach when netcoredbg is absent in Debug Mode', async () => {
    const ws = makeTempDir()
    const dllPath = path.join(ws, 'Api.dll')
    fs.writeFileSync(dllPath, '', 'utf8')

    const cfg: LaunchConfigItem = {
      id: '.::Api',
      name: 'Api',
      type: 'coreclr',
      request: 'launch',
      runnable: true,
      workspaceFolder: ws,
      relativeFolder: '.',
      program: dllPath,
    }

    const synth = await synthesizeLaunchCommand(cfg, 'debug', {
      allocatePort: async () => 4713,
      netcoredbgPath: null,
      editors: ['codium'],
    })

    expect(synth.command).toBe('dotnet')
    expect(synth.args).toEqual([dllPath])
    expect(synth.attach?.kind).toBe('dotnet-pid')
    expect(synth.attach?.note).toContain('netcoredbg')
  })

  it('synthesizes Node, Python, Go, and Cargo Run vs Debug commands', async () => {
    const ws = makeTempDir()

    const nodeCfg: LaunchConfigItem = {
      id: '.::Node',
      name: 'Node',
      type: 'pwa-node',
      request: 'launch',
      runnable: true,
      workspaceFolder: ws,
      relativeFolder: '.',
      program: '${workspaceFolder}/server.js',
      stopOnEntry: true,
    }
    const nodeDebug = await synthesizeLaunchCommand(nodeCfg, 'debug')
    expect(nodeDebug.command).toBe('node')
    expect(nodeDebug.env.NODE_OPTIONS).toContain('--inspect-brk=0')
    expect(nodeDebug.attach?.kind).toBe('node-inspector')

    const pyCfg: LaunchConfigItem = {
      id: '.::Py',
      name: 'Py',
      type: 'debugpy',
      request: 'launch',
      runnable: true,
      workspaceFolder: ws,
      relativeFolder: '.',
      module: 'uvicorn',
      args: ['main:app'],
    }
    const pyDebug = await synthesizeLaunchCommand(pyCfg, 'debug', { allocatePort: async () => 5678 })
    expect(pyDebug.args.slice(0, 5)).toEqual(['-m', 'debugpy', '--listen', '127.0.0.1:5678', '-m'])
    expect(pyDebug.attach).toMatchObject({ kind: 'debugpy', port: 5678 })

    const goCfg: LaunchConfigItem = {
      id: '.::Go',
      name: 'Go',
      type: 'go',
      request: 'launch',
      runnable: true,
      workspaceFolder: ws,
      relativeFolder: '.',
      program: './cmd/api',
    }
    const goDebug = await synthesizeLaunchCommand(goCfg, 'debug', { allocatePort: async () => 2345 })
    expect(goDebug.command).toBe('dlv')
    expect(goDebug.args).toContain('--listen=127.0.0.1:2345')

    const cargoCfg: LaunchConfigItem = {
      id: '.::Rust',
      name: 'Rust',
      type: 'lldb',
      request: 'launch',
      runnable: true,
      workspaceFolder: ws,
      relativeFolder: '.',
      cargoArgs: ['build', '--bin', 'demo'],
    }
    const cargoDebug = await synthesizeLaunchCommand(cargoCfg, 'debug')
    expect(cargoDebug.command).toBe('cargo')
    expect(cargoDebug.args).toEqual(['run', '--bin', 'demo'])
    expect(cargoDebug.env.RUST_BACKTRACE).toBe('1')

    // Additional adapter branches: projectPath, Python script run, Go run, generic fallback
    const projDotnet = await synthesizeLaunchCommand(
      { ...cargoCfg, id: '.::Proj', name: 'Proj', type: 'dotnet', cargoArgs: undefined, projectPath: 'src/Api.csproj' },
      'run',
    )
    expect(projDotnet.args.slice(0, 2)).toEqual(['run', '--project'])

    const pyRun = await synthesizeLaunchCommand(
      { ...pyCfg, module: undefined, program: 'app.py' },
      'run',
    )
    expect(pyRun.command).toBe('python')

    const goRun = await synthesizeLaunchCommand(goCfg, 'run')
    expect(goRun.command).toBe('go')
    expect(goRun.args[0]).toBe('run')

    const genericDebug = await synthesizeLaunchCommand(
      {
        id: '.::Custom',
        name: 'Custom',
        type: 'custom-runtime',
        request: 'launch',
        runnable: true,
        workspaceFolder: ws,
        relativeFolder: '.',
        runtimeExecutable: 'bun',
        program: 'index.ts',
        env: { PORT: '3000' },
      },
      'debug',
    )
    expect(genericDebug.command).toBe('bun')
    expect(genericDebug.attach?.kind).toBe('generic')

    fs.mkdirSync(path.join(ws, '.vscode'), { recursive: true })
    fs.writeFileSync(
      path.join(ws, '.vscode', 'tasks.json'),
      JSON.stringify({
        version: '2.0.0',
        tasks: [
          { label: 'tauri dev', type: 'shell', command: 'npm', args: ['run', 'dev:desktop'] },
        ],
      }),
      'utf8',
    )
    const attachTauri = await synthesizeLaunchCommand(
      {
        id: '.::Desktop app (Tauri)',
        name: 'Desktop app (Tauri)',
        type: 'chrome',
        request: 'attach',
        runnable: true,
        workspaceFolder: ws,
        relativeFolder: '.',
        port: 9222,
        preLaunchTask: 'tauri dev',
      },
      'debug',
    )
    expect(attachTauri.command).toBe('npm')
    expect(attachTauri.args).toEqual(['run', 'dev:desktop'])
    expect(attachTauri.attach?.port).toBe(9222)
    expect(attachTauri.preTask).toBeNull()

    // extensionHost launch
    const extHost = await synthesizeLaunchCommand(
      {
        id: '.::Run Extension',
        name: 'Run Extension',
        type: 'extensionHost',
        request: 'launch',
        runnable: true,
        workspaceFolder: ws,
        relativeFolder: '.',
        runtimeExecutable: '${execPath}',
        args: ['--extensionDevelopmentPath=${workspaceFolder}'],
      },
      'debug',
      { editors: ['codium'] },
    )
    expect(extHost.command).toMatch(/codium/i)
    expect(extHost.args).toContain(`--extensionDevelopmentPath=${ws}`)
    expect(extHost.attach?.kind).toBe('generic')

    // Browser launch (msedge with url)
    const browserLaunch = await synthesizeLaunchCommand(
      {
        id: '.::Web App',
        name: 'Web App',
        type: 'msedge',
        request: 'launch',
        runnable: true,
        workspaceFolder: ws,
        relativeFolder: '.',
        url: 'http://localhost:5173',
      },
      'run',
    )
    expect(browserLaunch.command).toMatch(/edge/i)
    expect(browserLaunch.args).toContain('http://localhost:5173')
  })
})
