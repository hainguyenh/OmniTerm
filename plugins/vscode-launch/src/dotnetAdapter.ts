import fs from 'node:fs'
import path from 'node:path'

import type { AdapterDeps, SynthesizedLaunch } from './adapters'
import {
  allocateLoopbackPort,
  buildNetCoreDbgAttachSnippet,
  detectInstalledEditors,
  findNetCoreDbg,
} from './netcoredbg'
import type { ResolvedTaskSpec } from './tasks'
import { hasDotnetProject } from './tasks'
import { formatTerminalCommand } from './terminalCommand'
import type { EditorKind, LaunchConfigItem, LaunchRunMode } from './types'

export function isDotnetLaunchType(normalizedType: string): boolean {
  return normalizedType === 'coreclr' || normalizedType === 'netcoredbg' || normalizedType === 'dotnet'
}

export function resolveDotnetTarget(
  program: string | undefined,
  projectPath: string | undefined,
  cwd: string,
): { command: string; args: string[]; targetBinary?: string } {
  if (program) {
    const resolved = path.resolve(cwd, program)
    return /\.dll$/i.test(resolved)
      ? { command: 'dotnet', args: [resolved], targetBinary: resolved }
      : { command: resolved, args: [], targetBinary: resolved }
  }
  if (projectPath) {
    return { command: 'dotnet', args: ['run', '--project', path.resolve(cwd, projectPath)] }
  }
  return { command: 'dotnet', args: ['run'] }
}

export async function synthesizeDotnetLaunch(params: {
  config: LaunchConfigItem
  mode: LaunchRunMode
  program?: string
  projectPath?: string
  userArgs: string[]
  cwd: string
  envOverrides: Record<string, string>
  baseEnv: Readonly<Record<string, string | undefined>>
  preTask: ResolvedTaskSpec | null
  deps: AdapterDeps
}): Promise<SynthesizedLaunch> {
  const { config, mode, program, projectPath, userArgs, cwd, envOverrides, baseEnv, deps } = params
  let preTask = params.preTask
  const allocatePort = deps.allocatePort ?? allocateLoopbackPort
  const dotnetTarget = resolveDotnetTarget(program, projectPath, cwd)
  const fullRunArgs = [...dotnetTarget.args, ...userArgs]

  if (!preTask && dotnetTarget.targetBinary && !fs.existsSync(dotnetTarget.targetBinary) && hasDotnetProject(cwd)) {
    preTask = {
      label: 'dotnet build',
      command: 'dotnet',
      args: ['build'],
      cwd,
      shell: false,
    }
  }

  const env = {
    ...(mode === 'debug' ? { ASPNETCORE_ENVIRONMENT: 'Development', DOTNET_ENVIRONMENT: 'Development' } : {}),
    ...envOverrides,
  }

  if (mode === 'debug') {
    const netcoredbgBin = deps.netcoredbgPath === undefined ? findNetCoreDbg({ env: baseEnv }) : deps.netcoredbgPath
    const editors = deps.editors ?? detectInstalledEditors({ env: baseEnv })
    const preferredEditor: EditorKind = editors.includes('codium') ? 'codium' : 'code'

    if (netcoredbgBin) {
      const port = await allocatePort()
      const dbgArgs = [
        '--interpreter=vscode',
        `--server=${port}`,
        '--',
        dotnetTarget.command,
        ...fullRunArgs,
      ]
      return {
        command: netcoredbgBin,
        args: dbgArgs,
        cwd,
        env,
        shell: false,
        terminalCommand: formatTerminalCommand(netcoredbgBin, dbgArgs),
        preTask,
        attach: {
          kind: 'netcoredbg-server',
          host: '127.0.0.1',
          port,
          attachJson: buildNetCoreDbgAttachSnippet({
            name: config.name,
            port,
            editor: preferredEditor,
            stopAtEntry: config.stopOnEntry,
          }),
          note: `netcoredbg DAP server listening on 127.0.0.1:${port} (VSCodium / VS Code compatible)`,
        },
      }
    }

    return {
      command: dotnetTarget.command,
      args: fullRunArgs,
      cwd,
      env,
      shell: false,
      terminalCommand: formatTerminalCommand(dotnetTarget.command, fullRunArgs),
      preTask,
      attach: {
        kind: 'dotnet-pid',
        attachJson: buildNetCoreDbgAttachSnippet({
          name: config.name,
          editor: preferredEditor,
        }),
        note: 'netcoredbg not found on PATH, NETCOREDBG_PATH, or ~/.vscode-oss/extensions — running dotnet in Development mode (attach via PID in VSCodium).',
      },
    }
  }

  return {
    command: dotnetTarget.command,
    args: fullRunArgs,
    cwd,
    env,
    shell: false,
    terminalCommand: formatTerminalCommand(dotnetTarget.command, fullRunArgs),
    preTask,
  }
}
