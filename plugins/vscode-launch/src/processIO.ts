import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

import type { ResolvedTaskSpec } from './tasks'
import type { AttachDescriptor, LaunchLogLine } from './types'

const HTTP_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+(?:\/[^\s"')>]*)?/gi
const WS_INSPECT_RE = /ws:\/\/(?:127\.0\.0\.1|localhost):\d+\/[^\s"')>]+/i

function quoteCmdToken(token: string): string {
  if (token.length === 0) return '""'
  if (/^[A-Za-z0-9_./:\\=-]+$/.test(token)) return token
  return `"${token.replace(/"/g, '\\"')}"`
}

function quoteShToken(token: string): string {
  if (token.length === 0) return "''"
  if (/^[A-Za-z0-9_./:\\=-]+$/.test(token)) return token
  return `'${token.replace(/'/g, "'\\''")}'`
}

/**
 * Spawn a child process without ever combining `shell: true` and an `args` array (eliminates Node 24
 * `DEP0190`, preserves spaces in paths, and avoids unquoted shell metacharacter concatenation).
 */
export function spawnSafe(
  command: string,
  args: readonly string[],
  options: Omit<SpawnOptions, 'shell'> & { useShell?: boolean },
): ChildProcess {
  const { useShell = false, ...rest } = options
  const isWinCmdShim = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)

  if (useShell || isWinCmdShim) {
    if (process.platform === 'win32') {
      const comspec = process.env.ComSpec || 'cmd.exe'
      const inner = [quoteCmdToken(command), ...args.map(quoteCmdToken)].join(' ')
      return spawn(comspec, ['/d', '/s', '/c', `"${inner}"`], {
        ...rest,
        shell: false,
        windowsVerbatimArguments: true,
      })
    }
    const line = [quoteShToken(command), ...args.map(quoteShToken)].join(' ')
    return spawn('/bin/sh', ['-c', line], {
      ...rest,
      shell: false,
    })
  }

  return spawn(command, [...args], {
    ...rest,
    shell: false,
  })
}

export function extractLineTelemetry(
  text: string,
  listeningUrls: string[],
  currentAttach: AttachDescriptor | undefined,
): AttachDescriptor | undefined {
  for (const match of text.matchAll(HTTP_URL_RE)) {
    const url = match[0]
    if (url && !listeningUrls.includes(url) && listeningUrls.length < 6) {
      listeningUrls.push(url)
    }
  }
  const wsMatch = text.match(WS_INSPECT_RE)
  if (wsMatch) {
    return {
      ...(currentAttach ?? { kind: 'node-inspector' }),
      wsUrl: wsMatch[0],
    }
  }
  return currentAttach
}

export function pipeStreamLines(
  stream: NodeJS.ReadableStream | null | undefined,
  onLine: (line: string) => void,
): void {
  if (!stream) return
  let remainder = ''
  stream.on('data', (chunk: Buffer | string) => {
    remainder += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    const parts = remainder.split(/\r?\n/)
    remainder = parts.pop() ?? ''
    for (const part of parts) onLine(part)
  })
  stream.on('end', () => {
    if (remainder.length > 0) {
      onLine(remainder)
      remainder = ''
    }
  })
}

export function killProcessTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    const pid = child.pid
    if (!pid || child.exitCode !== null || child.killed) {
      try {
        child.kill()
      } catch {
        // Already exited
      }
      resolve()
      return
    }

    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    child.once('close', done)
    setTimeout(done, 1_500).unref()

    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {
        try {
          child.kill()
        } catch {
          // Ignore
        }
      })
      return
    }

    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      try {
        child.kill('SIGTERM')
      } catch {
        done()
      }
    }
    setTimeout(() => {
      if (settled) return
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          // Ignore
        }
      }
    }, 500).unref()
  })
}

export function executePreTask(params: {
  task: ResolvedTaskSpec
  extraEnv: Record<string, string>
  isStopping: () => boolean
  setChild: (proc: ChildProcess | null) => void
  onLog: (stream: LaunchLogLine['stream'], text: string) => void
}): Promise<boolean> {
  const { task, extraEnv, isStopping, setChild, onLog } = params
  onLog('system', `[preLaunchTask] Running "${task.label}": ${task.command} ${task.args.join(' ')}`)
  return new Promise((resolve) => {
    let proc: ChildProcess
    try {
      proc = spawnSafe(task.command, task.args, {
        cwd: task.cwd,
        env: { ...process.env, ...extraEnv, ...(task.env ?? {}) },
        useShell: task.shell,
        windowsHide: true,
      })
    } catch (err) {
      onLog('stderr', `[preLaunchTask] Failed to spawn: ${err instanceof Error ? err.message : String(err)}`)
      resolve(false)
      return
    }
    setChild(proc)

    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      if (readyTimer) clearTimeout(readyTimer)
      resolve(ok)
    }

    const readyRegex = task.isBackground
      ? new RegExp(
          task.readyPattern ??
            '(?:watching for file changes|compiled successfully|ready in|listening on|server running|found 0 errors)',
          'i',
        )
      : null

    let readyTimer: NodeJS.Timeout | null = null
    if (task.isBackground) {
      readyTimer = setTimeout(() => {
        if (!settled && !isStopping()) {
          onLog('system', `[preLaunchTask] "${task.label}" is running in background.`)
          finish(true)
        }
      }, 5_000)
      readyTimer.unref?.()
    }

    const checkReadyLine = (line: string) => {
      if (!settled && task.isBackground && readyRegex && readyRegex.test(line)) {
        onLog('system', `[preLaunchTask] "${task.label}" is ready.`)
        finish(true)
      }
    }

    pipeStreamLines(proc.stdout, (line) => {
      onLog('stdout', line)
      checkReadyLine(line)
    })
    pipeStreamLines(proc.stderr, (line) => {
      onLog('stderr', line)
      checkReadyLine(line)
    })
    proc.on('error', (err) => {
      setChild(null)
      onLog('stderr', `[preLaunchTask] Error: ${err.message}`)
      finish(false)
    })
    proc.on('close', (code) => {
      setChild(null)
      if (isStopping()) {
        finish(false)
        return
      }
      if (code === 0) {
        onLog('system', `[preLaunchTask] "${task.label}" completed.`)
        finish(true)
      } else {
        onLog('stderr', `[preLaunchTask] "${task.label}" exited with code ${code ?? 'unknown'}.`)
        finish(false)
      }
    })
  })
}
