import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { AdapterDeps, SynthesizedLaunch } from './adapters'
import { detectInstalledEditors, resolveEditorBinary } from './netcoredbg'
import type { ResolvedTaskSpec } from './tasks'
import { formatTerminalCommand } from './terminalCommand'
import type { EditorKind, LaunchConfigItem, LaunchRunMode } from './types'
import { expandVariables, type VariableContext } from './variables'

const BROWSER_TYPES = new Set(['chrome', 'pwa-chrome', 'msedge', 'pwa-msedge', 'firefox', 'edge'])
const EXTENSION_HOST_TYPES = new Set(['extensionhost', 'extension-host', 'vscode-extension'])

export function isBrowserLaunchType(type: string): boolean {
  return BROWSER_TYPES.has(type.toLowerCase())
}

export function isExtensionHostLaunchType(type: string): boolean {
  return EXTENSION_HOST_TYPES.has(type.toLowerCase())
}

function findBrowserExecutable(
  type: string,
  runtimeExecutable: string | undefined,
  baseEnv: Readonly<Record<string, string | undefined>>,
): { bin: string; shell: boolean } {
  if (runtimeExecutable) {
    return {
      bin: runtimeExecutable,
      shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(runtimeExecutable),
    }
  }

  const lower = type.toLowerCase()
  const isEdge = lower.includes('edge')
  const isFirefox = lower.includes('firefox')

  if (process.platform === 'win32') {
    const progFiles = baseEnv.ProgramFiles ?? 'C:\\Program Files'
    const progFilesX86 = baseEnv['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    const localAppData = baseEnv.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')

    let candidates: string[] = []
    if (isEdge) {
      candidates = [
        path.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]
    } else if (isFirefox) {
      candidates = [
        path.join(progFiles, 'Mozilla Firefox', 'firefox.exe'),
        path.join(progFilesX86, 'Mozilla Firefox', 'firefox.exe'),
      ]
    } else {
      candidates = [
        path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ]
    }

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return { bin: cand, shell: false }
      }
    }

    const fallback = isEdge ? 'msedge' : isFirefox ? 'firefox' : 'chrome'
    return { bin: fallback, shell: true }
  }

  if (process.platform === 'darwin') {
    const macApp = isEdge
      ? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
      : isFirefox
        ? '/Applications/Firefox.app/Contents/MacOS/firefox'
        : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    if (fs.existsSync(macApp)) {
      return { bin: macApp, shell: false }
    }
    return { bin: isEdge ? 'msedge' : isFirefox ? 'firefox' : 'google-chrome', shell: false }
  }

  const linuxBin = isEdge ? 'microsoft-edge' : isFirefox ? 'firefox' : 'google-chrome'
  return { bin: linuxBin, shell: false }
}

export function synthesizeBrowserLaunch(params: {
  config: LaunchConfigItem
  mode: LaunchRunMode
  ctx: VariableContext
  userArgs: string[]
  runtimeArgs: string[]
  runtimeExecutable?: string
  cwd: string
  envOverrides: Record<string, string>
  baseEnv: Readonly<Record<string, string | undefined>>
  preTask: ResolvedTaskSpec | null
}): SynthesizedLaunch {
  const { config, mode, ctx, userArgs, runtimeArgs, runtimeExecutable, cwd, envOverrides, baseEnv, preTask } = params
  const { bin, shell } = findBrowserExecutable(config.type, runtimeExecutable, baseEnv)
  const targetUrl = config.url ? expandVariables(config.url, ctx) : undefined

  const debugArgs: string[] = []
  if (mode === 'debug' && !config.type.toLowerCase().includes('firefox')) {
    const hasPort = userArgs.some((a) => a.startsWith('--remote-debugging-port'))
    if (!hasPort) {
      debugArgs.push('--remote-debugging-port=9222')
    }
  }

  const args = [
    ...runtimeArgs,
    ...debugArgs,
    ...(targetUrl ? [targetUrl] : []),
    ...userArgs,
  ]

  const browserName = config.type.toLowerCase().includes('edge')
    ? 'Microsoft Edge'
    : config.type.toLowerCase().includes('firefox')
      ? 'Firefox'
      : 'Google Chrome'

  return {
    command: bin,
    args,
    cwd,
    env: envOverrides,
    shell,
    terminalCommand: formatTerminalCommand(bin, args),
    preTask,
    attach: {
      kind: 'generic',
      port: 9222,
      note: `${browserName} launched${targetUrl ? ` at ${targetUrl}` : ''}${mode === 'debug' ? ' (remote debugging on :9222)' : ''}`,
    },
  }
}

export function synthesizeExtensionHostLaunch(params: {
  config: LaunchConfigItem
  mode: LaunchRunMode
  userArgs: string[]
  runtimeArgs: string[]
  runtimeExecutable?: string
  cwd: string
  envOverrides: Record<string, string>
  baseEnv: Readonly<Record<string, string | undefined>>
  preTask: ResolvedTaskSpec | null
  deps: AdapterDeps
}): SynthesizedLaunch {
  const { config, mode, userArgs, runtimeArgs, runtimeExecutable, cwd, envOverrides, baseEnv, preTask, deps } = params
  const editors = deps.editors ?? detectInstalledEditors({ env: baseEnv })
  const preferredEditor: EditorKind = editors.includes('codium') ? 'codium' : 'code'
  const resolved = resolveEditorBinary(preferredEditor, { env: baseEnv })

  let command = resolved?.bin ?? (process.platform === 'win32' ? `${preferredEditor}.cmd` : preferredEditor)
  let isShell = resolved?.isCmdShim ?? (process.platform === 'win32')

  if (runtimeExecutable && runtimeExecutable !== '${execPath}') {
    command = runtimeExecutable
    isShell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)
  }

  const hasDevPath = userArgs.some((arg) => arg.startsWith('--extensionDevelopmentPath'))
  const defaultDevPath = hasDevPath ? [] : [`--extensionDevelopmentPath=${config.workspaceFolder}`]
  const rawArgs = [...runtimeArgs, ...defaultDevPath, ...userArgs]
  const args = rawArgs.map((arg) => {
    if (process.platform === 'win32' && arg.startsWith('--extensionDevelopmentPath=')) {
      const devPath = arg.slice('--extensionDevelopmentPath='.length)
      return `--extensionDevelopmentPath=${path.normalize(devPath)}`
    }
    return arg
  })

  return {
    command,
    args,
    cwd,
    env: envOverrides,
    shell: isShell,
    terminalCommand: formatTerminalCommand(command, args),
    preTask,
    attach: {
      kind: 'generic',
      note: `Extension Host launched in ${preferredEditor === 'codium' ? 'VSCodium' : 'VS Code'}${mode === 'debug' ? ' (debug mode)' : ''}`,
    },
  }
}
