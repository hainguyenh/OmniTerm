import path from 'node:path'

import {
  isBrowserLaunchType,
  isExtensionHostLaunchType,
  synthesizeBrowserLaunch,
  synthesizeExtensionHostLaunch,
} from './browserAndExtensionAdapters'
import {
  isDotnetLaunchType,
  resolveDotnetTarget,
  synthesizeDotnetLaunch,
} from './dotnetAdapter'
import { allocateLoopbackPort } from './netcoredbg'
import type { ResolvedTaskSpec } from './tasks'
import { resolvePreLaunchTask } from './tasks'
import { formatTerminalCommand } from './terminalCommand'
import type {
  AttachDescriptor,
  EditorKind,
  LaunchConfigItem,
  LaunchRunMode,
} from './types'
import {
  createDefaultVariableContext,
  expandStringArray,
  expandVariables,
  loadEnvFile,
} from './variables'

export interface SynthesizedLaunch {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  shell: boolean
  terminalCommand: string
  preTask: ResolvedTaskSpec | null
  attach?: AttachDescriptor
}

export interface AdapterDeps {
  allocatePort?: () => Promise<number>
  netcoredbgPath?: string | null
  editors?: EditorKind[]
  baseEnv?: Readonly<Record<string, string | undefined>>
}

export { formatTerminalCommand, resolveDotnetTarget }

function resolveEnvMap(
  config: LaunchConfigItem,
  baseEnv: Readonly<Record<string, string | undefined>>,
  editors?: readonly EditorKind[],
): Record<string, string> {
  const initialCtx = createDefaultVariableContext(config.workspaceFolder, baseEnv, editors)
  const fromEnvFile = config.envFile
    ? loadEnvFile(path.resolve(config.workspaceFolder, expandVariables(config.envFile, initialCtx)))
    : {}
  const mergedCtx = createDefaultVariableContext(config.workspaceFolder, {
    ...baseEnv,
    ...fromEnvFile,
  }, editors)
  const explicit: Record<string, string> = {}
  if (config.env) {
    for (const [k, v] of Object.entries(config.env)) {
      explicit[k] = expandVariables(v, mergedCtx)
    }
  }
  return { ...fromEnvFile, ...explicit }
}

export async function synthesizeLaunchCommand(
  config: LaunchConfigItem,
  mode: LaunchRunMode,
  deps: AdapterDeps = {},
): Promise<SynthesizedLaunch> {
  const baseEnv = deps.baseEnv ?? process.env
  const envOverrides = resolveEnvMap(config, baseEnv, deps.editors)
  const ctx = createDefaultVariableContext(config.workspaceFolder, {
    ...baseEnv,
    ...envOverrides,
  }, deps.editors)

  const cwd = config.cwd
    ? path.resolve(config.workspaceFolder, expandVariables(config.cwd, ctx))
    : config.workspaceFolder
  const program = config.program ? expandVariables(config.program, ctx) : undefined
  const runtimeExecutable = config.runtimeExecutable ? expandVariables(config.runtimeExecutable, ctx) : undefined
  const runtimeArgs = expandStringArray(config.runtimeArgs, ctx)
  const userArgs = expandStringArray(config.args, ctx)
  const projectPath = config.projectPath ? expandVariables(config.projectPath, ctx) : undefined

  const preTask = config.preLaunchTask
    ? resolvePreLaunchTask(config.workspaceFolder, config.preLaunchTask, ctx)
    : null

  const normalizedType = config.type.toLowerCase()
  const allocatePort = deps.allocatePort ?? allocateLoopbackPort

  if (config.request === 'attach' && !program && !runtimeExecutable) {
    const port = config.port
    if (preTask) {
      const needsShell = preTask.shell || (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(preTask.command))
      return {
        command: preTask.command,
        args: preTask.args,
        cwd: preTask.cwd,
        env: { ...envOverrides, ...(preTask.env ?? {}) },
        shell: needsShell,
        terminalCommand: formatTerminalCommand(preTask.command, preTask.args),
        preTask: null,
        attach: {
          kind: 'generic',
          port,
          note: port ? `Listening on port ${port} (${preTask.label})` : `Running task "${preTask.label}"`,
        },
      }
    }
    return {
      command: process.execPath,
      args: ['-e', `console.log("Attach session ready on port ${port ?? 'target'}. Press Ctrl+C to stop."); setInterval(() => {}, 1000);`],
      cwd,
      env: envOverrides,
      shell: false,
      terminalCommand: `node (attach on port ${port ?? 'target'})`,
      preTask: null,
      attach: {
        kind: 'generic',
        port,
        note: port ? `Attach endpoint on port ${port}` : 'Attach configuration active',
      },
    }
  }

  if (isDotnetLaunchType(normalizedType)) {
    return synthesizeDotnetLaunch({
      config,
      mode,
      program,
      projectPath,
      userArgs,
      cwd,
      envOverrides,
      baseEnv,
      preTask,
      deps,
    })
  }

  if (normalizedType === 'node' || normalizedType === 'pwa-node' || normalizedType === 'node-terminal') {
    const command = runtimeExecutable ?? 'node'
    const resolvedProg = program ? (path.isAbsolute(program) ? program : path.resolve(cwd, program)) : undefined
    const args = [...runtimeArgs, ...(resolvedProg ? [resolvedProg] : []), ...userArgs]
    const env = { ...envOverrides }
    let attach: AttachDescriptor | undefined

    if (mode === 'debug') {
      const inspectFlag = config.stopOnEntry ? '--inspect-brk=0' : '--inspect=0'
      const existingNodeOpts = env.NODE_OPTIONS ?? baseEnv.NODE_OPTIONS ?? ''
      env.NODE_OPTIONS = existingNodeOpts ? `${existingNodeOpts} ${inspectFlag}` : inspectFlag
      attach = {
        kind: 'node-inspector',
        note: 'Node.js V8 Inspector active — attach via DevTools or VSCodium / VS Code.',
      }
    }

    const needsWinCmdShell = process.platform === 'win32' && /^(npm|pnpm|yarn|npx|tsx)$/i.test(command)
    return {
      command,
      args,
      cwd,
      env,
      shell: needsWinCmdShell,
      terminalCommand: formatTerminalCommand(command, args),
      preTask,
      ...(attach ? { attach } : {}),
    }
  }

  if (normalizedType === 'python' || normalizedType === 'debugpy') {
    const pyExec = config.python ? expandVariables(config.python, ctx) : 'python'
    const targetArgs = config.module
      ? ['-m', expandVariables(config.module, ctx), ...userArgs]
      : [
          ...(program ? [path.isAbsolute(program) ? program : path.resolve(cwd, program)] : []),
          ...userArgs,
        ]
    const env = { PYTHONUNBUFFERED: '1', ...envOverrides }

    if (mode === 'debug') {
      const port = await allocatePort()
      const debugArgs = [
        '-m',
        'debugpy',
        '--listen',
        `127.0.0.1:${port}`,
        ...(config.stopOnEntry ? ['--wait-for-client'] : []),
        ...targetArgs,
      ]
      return {
        command: pyExec,
        args: debugArgs,
        cwd,
        env,
        shell: false,
        terminalCommand: formatTerminalCommand(pyExec, debugArgs),
        preTask,
        attach: {
          kind: 'debugpy',
          host: '127.0.0.1',
          port,
          note: `Python debugpy listening on 127.0.0.1:${port}`,
        },
      }
    }

    return {
      command: pyExec,
      args: targetArgs,
      cwd,
      env,
      shell: false,
      terminalCommand: formatTerminalCommand(pyExec, targetArgs),
      preTask,
    }
  }

  if (normalizedType === 'go') {
    const targetPkg = program ?? '.'
    if (mode === 'debug') {
      const port = await allocatePort()
      const dlvArgs = [
        'debug',
        targetPkg,
        '--headless',
        `--listen=127.0.0.1:${port}`,
        '--api-version=2',
        ...(userArgs.length > 0 ? ['--', ...userArgs] : []),
      ]
      return {
        command: 'dlv',
        args: dlvArgs,
        cwd,
        env: envOverrides,
        shell: false,
        terminalCommand: formatTerminalCommand('dlv', dlvArgs),
        preTask,
        attach: {
          kind: 'dlv',
          host: '127.0.0.1',
          port,
          note: `Delve headless DAP server on 127.0.0.1:${port}`,
        },
      }
    }

    const goArgs = ['run', targetPkg, ...userArgs]
    return {
      command: 'go',
      args: goArgs,
      cwd,
      env: envOverrides,
      shell: false,
      terminalCommand: formatTerminalCommand('go', goArgs),
      preTask,
    }
  }

  if (config.cargoArgs && config.cargoArgs.length > 0) {
    const cargoSubArgs = expandStringArray(config.cargoArgs, ctx)
    const runSubArgs = cargoSubArgs[0] === 'build' || cargoSubArgs[0] === 'test'
      ? ['run', ...cargoSubArgs.slice(1)]
      : cargoSubArgs
    const fullCargoArgs = [...runSubArgs, ...(userArgs.length > 0 ? ['--', ...userArgs] : [])]
    const env = {
      ...(mode === 'debug' ? { RUST_BACKTRACE: '1', RUST_LOG: envOverrides.RUST_LOG ?? 'debug' } : {}),
      ...envOverrides,
    }
    return {
      command: 'cargo',
      args: fullCargoArgs,
      cwd,
      env,
      shell: false,
      terminalCommand: formatTerminalCommand('cargo', fullCargoArgs),
      preTask,
      ...(mode === 'debug' ? { attach: { kind: 'generic', note: 'Running with RUST_BACKTRACE=1' } } : {}),
    }
  }

  if (isExtensionHostLaunchType(normalizedType)) {
    return synthesizeExtensionHostLaunch({
      config,
      mode,
      userArgs,
      runtimeArgs,
      runtimeExecutable,
      cwd,
      envOverrides,
      baseEnv,
      preTask,
      deps,
    })
  }

  if (isBrowserLaunchType(normalizedType)) {
    return synthesizeBrowserLaunch({
      config,
      mode,
      ctx,
      userArgs,
      runtimeArgs,
      runtimeExecutable,
      cwd,
      envOverrides,
      baseEnv,
      preTask,
    })
  }

  const fallbackCommand = runtimeExecutable ?? (program ? (path.isAbsolute(program) ? program : path.resolve(cwd, program)) : 'node')
  const fallbackArgs = runtimeExecutable
    ? [...runtimeArgs, ...(program ? [program] : []), ...userArgs]
    : userArgs
  const fallbackEnv = {
    ...(mode === 'debug' ? { RUST_BACKTRACE: '1', DEBUG: envOverrides.DEBUG ?? '*' } : {}),
    ...envOverrides,
  }
  const needsShell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(fallbackCommand)

  return {
    command: fallbackCommand,
    args: fallbackArgs,
    cwd,
    env: fallbackEnv,
    shell: needsShell,
    terminalCommand: formatTerminalCommand(fallbackCommand, fallbackArgs),
    preTask,
    ...(mode === 'debug' ? { attach: { kind: 'generic', note: 'Debug environment enabled' } } : {}),
  }
}
