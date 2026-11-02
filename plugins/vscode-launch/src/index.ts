import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { resolveEditorBinary } from './netcoredbg'
import { createLaunchRunner } from './runner'
import type { EditorKind, LaunchRunMode } from './types'

type InvokeHandler = (method: string, ...args: unknown[]) => unknown

interface Host {
  registerInvokeHandler(handler: InvokeHandler): void
  services: {
    log(message: string): void
    writeClipboard?(text: string): Promise<void>
    openExternal?(url: string): Promise<void>
  }
}

export const name = '@omniterm/vscode-launch'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function validatePathString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 1024 || value.includes('\0')) {
    throw new Error(`Invalid ${label}`)
  }
  return path.resolve(value)
}

function validateMode(value: unknown): LaunchRunMode {
  if (value === 'debug') return 'debug'
  if (value === 'run' || value === undefined) return 'run'
  throw new Error('Invalid launch mode')
}

function validateIdList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}`)
  return value.map((item) => {
    if (typeof item !== 'string' || item.length === 0 || item.length > 512 || item.includes('\0')) {
      throw new Error(`Invalid item in ${label}`)
    }
    return item
  })
}

export function openFolderInEditor(
  folderPath: string,
  preferredEditor?: EditorKind,
  installed: EditorKind[] = [],
): Promise<{ ok: boolean; editor?: EditorKind; message?: string }> {
  const resolved = validatePathString(folderPath, 'folderPath')
  try {
    if (!fs.statSync(resolved).isDirectory()) {
      return Promise.resolve({ ok: false, message: 'Target path is not an existing directory.' })
    }
  } catch {
    return Promise.resolve({ ok: false, message: 'Target folder does not exist on disk.' })
  }

  const editor: EditorKind = preferredEditor ?? (installed.includes('codium') ? 'codium' : 'code')
  const resolvedBin = resolveEditorBinary(editor)
  if (!resolvedBin) {
    return Promise.resolve({ ok: false, editor, message: `${editor} was not found on this machine.` })
  }

  return new Promise((resolve) => {
    if (resolvedBin.isCmdShim && process.platform === 'win32') {
      const comspec = process.env.ComSpec || 'cmd.exe'
      const safeBin = resolvedBin.bin.replace(/%/g, '%%').replace(/"/g, '""')
      const safeTarget = resolved.replace(/%/g, '%%').replace(/"/g, '""')
      execFile(
        comspec,
        ['/d', '/s', '/c', `""${safeBin}" "${safeTarget}""`],
        { windowsHide: true, shell: false, windowsVerbatimArguments: true },
        (err) => {
          if (err) resolve({ ok: false, editor, message: `Could not launch ${editor}: ${err.message}` })
          else resolve({ ok: true, editor })
        },
      )
      return
    }

    execFile(resolvedBin.bin, [resolved], { windowsHide: true, shell: false }, (err) => {
      if (err) {
        resolve({ ok: false, editor, message: `Could not launch ${editor}: ${err.message}` })
      } else {
        resolve({ ok: true, editor })
      }
    })
  })
}

let activeRunner: ReturnType<typeof createLaunchRunner> | null = null

export function activate(host: Host): void {
  const runner = activeRunner ?? createLaunchRunner()
  activeRunner = runner

  host.registerInvokeHandler((method, ...args) => {
    if (method === 'vscodeLaunch.info') {
      return {
        name: 'VS Code Launch Runner',
        version: '0.1.0',
        editors: runner.getEditors(),
      }
    }

    if (method === 'vscodeLaunch.discover') {
      const rootDir = validatePathString(args[0], 'rootDir')
      return runner.discover(rootDir)
    }

    if (method === 'vscodeLaunch.start') {
      const payload = isRecord(args[0]) ? args[0] : {}
      const rootDir = validatePathString(payload.rootDir, 'rootDir')
      const mode = validateMode(payload.mode)
      const compoundId = typeof payload.compoundId === 'string' && payload.compoundId.length <= 512
        ? payload.compoundId
        : undefined
      const configIds = payload.configIds !== undefined ? validateIdList(payload.configIds, 'configIds') : undefined
      return runner.start({ rootDir, configIds, compoundId, mode })
    }

    if (method === 'vscodeLaunch.stop') {
      const payload = isRecord(args[0]) ? args[0] : {}
      if (typeof payload.allInRoot === 'string') {
        return runner.stopInRoot(validatePathString(payload.allInRoot, 'allInRoot')).then((stopped) => ({ stopped }))
      }
      if (payload.all === true) {
        return runner.stopAll().then((stopped) => ({ stopped }))
      }
      const runIds = validateIdList(payload.runIds, 'runIds')
      return runner.stop(runIds).then((stopped) => ({ stopped }))
    }

    if (method === 'vscodeLaunch.removeRun') {
      const payload = isRecord(args[0]) ? args[0] : {}
      if (typeof payload.runId !== 'string' || payload.runId.length === 0 || payload.runId.length > 128) {
        throw new Error('Invalid runId')
      }
      return runner.removeRun(payload.runId).then((ok) => ({ ok }))
    }

    if (method === 'vscodeLaunch.restart') {
      const payload = isRecord(args[0]) ? args[0] : {}
      if (typeof payload.runId !== 'string' || payload.runId.length === 0 || payload.runId.length > 128) {
        throw new Error('Invalid runId')
      }
      const mode = payload.mode !== undefined ? validateMode(payload.mode) : undefined
      return runner.restart(payload.runId, mode)
    }

    if (method === 'vscodeLaunch.listRuns') {
      return runner.listRuns()
    }

    if (method === 'vscodeLaunch.readLogs') {
      const payload = isRecord(args[0]) ? args[0] : {}
      if (typeof payload.runId !== 'string' || payload.runId.length === 0 || payload.runId.length > 128) {
        throw new Error('Invalid runId')
      }
      const afterSeq = typeof payload.afterSeq === 'number' && Number.isInteger(payload.afterSeq) && payload.afterSeq >= 0
        ? payload.afterSeq
        : 0
      return runner.readLogs(payload.runId, afterSeq)
    }

    if (method === 'vscodeLaunch.sendInput') {
      const payload = isRecord(args[0]) ? args[0] : {}
      if (typeof payload.runId !== 'string' || payload.runId.length === 0 || payload.runId.length > 128) {
        throw new Error('Invalid runId')
      }
      if (typeof payload.data !== 'string' || payload.data.length > 8192) {
        throw new Error('Invalid input data')
      }
      return { ok: runner.sendInput(payload.runId, payload.data) }
    }

    if (method === 'vscodeLaunch.openInEditor') {
      const payload = isRecord(args[0]) ? args[0] : {}
      const folderPath = validatePathString(payload.folderPath, 'folderPath')
      const editor = payload.editor === 'codium' || payload.editor === 'code' ? payload.editor : undefined
      return openFolderInEditor(folderPath, editor, runner.getEditors())
    }

    if (method === 'vscodeLaunch.openUrl') {
      const payload = isRecord(args[0]) ? args[0] : {}
      const rawUrl = typeof payload.url === 'string' ? payload.url : ''
      try {
        const parsed = new URL(rawUrl)
        const isAllowedHttp =
          parsed.protocol === 'http:' &&
          (parsed.hostname === 'localhost' ||
            parsed.hostname === '127.0.0.1' ||
            parsed.hostname === '[::1]' ||
            parsed.hostname === '0.0.0.0')
        if (parsed.protocol === 'https:' || isAllowedHttp) {
          if (host.services.openExternal) {
            return host.services.openExternal(rawUrl).then(
              () => ({ ok: true }),
              () => ({ ok: false }),
            )
          }
        }
      } catch {}
      return { ok: false }
    }

    throw new Error(`Unknown vscode-launch method "${method}"`)
  })

  host.services.log('VS Code Launch Runner activated')
}

export async function deactivate(): Promise<void> {
  if (!activeRunner) return
  await activeRunner.stopAll()
}

export default { name, activate, deactivate }
