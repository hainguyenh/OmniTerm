import type { ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'

import { synthesizeLaunchCommand, type AdapterDeps } from './adapters'
import { buildNetCoreDbgAttachSnippet, detectInstalledEditors } from './netcoredbg'
import {
  executePreTask,
  extractLineTelemetry,
  killProcessTree,
  pipeStreamLines,
  spawnSafe,
} from './processIO'
import { createLaunchScanner } from './scanner'
import { resolveStartPlan, type StartLaunchRequest } from './startPlan'
import type {
  DiscoveryResult,
  EditorKind,
  LaunchConfigItem,
  LaunchLogChunk,
  LaunchLogLine,
  LaunchRunMode,
  LaunchRunSummary,
} from './types'

export type { StartLaunchRequest }

export interface RunnerDeps extends AdapterDeps {
  maxLogLines?: number
  maxRetainedRuns?: number
  now?: () => number
}

interface ManagedRun {
  config: LaunchConfigItem
  summary: LaunchRunSummary
  lines: LaunchLogLine[]
  nextSeq: number
  droppedLines: number
  child: ChildProcess | null
  backgroundChild?: ChildProcess | null
  stopping: boolean
  compoundGroupId?: string
  stopAllPeers?: boolean
}

function cloneSummary(summary: LaunchRunSummary): LaunchRunSummary {
  return {
    ...summary,
    listeningUrls: [...summary.listeningUrls],
    ...(summary.attach ? { attach: { ...summary.attach } } : {}),
  }
}

export function createLaunchRunner(deps: RunnerDeps = {}) {
  const maxLogLines = Math.max(8, deps.maxLogLines ?? 4_000)
  const maxRetainedRuns = Math.max(1, deps.maxRetainedRuns ?? 24)
  const now = deps.now ?? (() => Date.now())
  const scanner = createLaunchScanner()
  const runs = new Map<string, ManagedRun>()

  function getEditors(): EditorKind[] {
    return deps.editors ?? detectInstalledEditors()
  }

  function discover(rootDir: string): DiscoveryResult {
    return scanner.discover(rootDir, getEditors())
  }

  function pruneTerminatedRuns(): void {
    const terminated = Array.from(runs.values())
      .filter((r) => r.summary.status !== 'starting' && r.summary.status !== 'running')
      .sort((a, b) => (a.summary.endedAt ?? a.summary.startedAt) - (b.summary.endedAt ?? b.summary.startedAt))

    while (terminated.length > maxRetainedRuns) {
      const oldest = terminated.shift()
      if (oldest) runs.delete(oldest.summary.runId)
    }
  }

  function appendLine(run: ManagedRun, stream: LaunchLogLine['stream'], text: string): void {
    const seq = run.nextSeq
    run.nextSeq += 1
    run.lines.push({ seq, stream, text, timestamp: now() })
    if (run.lines.length > maxLogLines) {
      const overflow = run.lines.length - maxLogLines
      run.lines.splice(0, overflow)
      run.droppedLines += overflow
    }
    const updatedAttach = extractLineTelemetry(text, run.summary.listeningUrls, run.summary.attach)
    if (updatedAttach) run.summary.attach = updatedAttach
  }

  async function launchOne(
    rootDir: string,
    config: LaunchConfigItem,
    mode: LaunchRunMode,
    options?: {
      compoundGroupId?: string
      stopAllPeers?: boolean
      warningLines?: string[]
      sharedPreTaskGate?: Promise<boolean>
    },
  ): Promise<LaunchRunSummary> {
    const synth = await synthesizeLaunchCommand(config, mode, deps)
    const runId = crypto.randomUUID()
    const summary: LaunchRunSummary = {
      runId,
      configId: config.id,
      name: config.name,
      type: config.type,
      mode,
      status: 'starting',
      rootDir,
      workspaceFolder: config.workspaceFolder,
      relativeFolder: config.relativeFolder,
      cwd: synth.cwd,
      terminalCommand: synth.terminalCommand,
      startedAt: now(),
      listeningUrls: [],
      ...(synth.attach ? { attach: { ...synth.attach } } : {}),
    }

    const managed: ManagedRun = {
      config,
      summary,
      lines: [],
      nextSeq: 1,
      droppedLines: 0,
      child: null,
      stopping: false,
      compoundGroupId: options?.compoundGroupId,
      stopAllPeers: options?.stopAllPeers,
    }
    runs.set(runId, managed)
    pruneTerminatedRuns()

    for (const warn of options?.warningLines ?? []) appendLine(managed, 'system', warn)
    if (summary.attach?.note) appendLine(managed, 'system', summary.attach.note)

    void (async () => {
      if (options?.sharedPreTaskGate) {
        const compoundOk = await options.sharedPreTaskGate
        if (!compoundOk) {
          managed.summary.status = managed.stopping ? 'stopped' : 'failed'
          managed.summary.endedAt = now()
          managed.summary.error = managed.stopping ? undefined : 'Compound preLaunchTask failed'
          return
        }
      }

      if (synth.preTask) {
        const ok = await executePreTask({
          task: synth.preTask,
          extraEnv: synth.env,
          isStopping: () => managed.stopping,
          setChild: (proc) => {
            if (synth.preTask?.isBackground) {
              managed.backgroundChild = proc
            } else {
              managed.child = proc
            }
          },
          onLog: (stream, text) => appendLine(managed, stream, text),
        })
        if (!ok) {
          managed.summary.status = managed.stopping ? 'stopped' : 'failed'
          managed.summary.endedAt = now()
          managed.summary.error = managed.stopping ? undefined : `preLaunchTask "${synth.preTask.label}" failed`
          return
        }
      }
      if (managed.stopping) {
        managed.summary.status = 'stopped'
        managed.summary.endedAt = now()
        return
      }

      appendLine(managed, 'system', `[launch:${mode}] ${synth.terminalCommand}`)
      let child: ChildProcess
      try {
        const lowerCmd = synth.command.toLowerCase()
        const isGui =
          lowerCmd.includes('codium') ||
          lowerCmd.includes('code') ||
          lowerCmd.includes('chrome') ||
          lowerCmd.includes('edge')

        child = spawnSafe(synth.command, synth.args, {
          cwd: synth.cwd,
          env: { ...process.env, ...synth.env },
          useShell: synth.shell,
          detached: process.platform !== 'win32',
          windowsHide: !isGui,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        appendLine(managed, 'stderr', `Spawn failed: ${msg}`)
        managed.summary.status = 'failed'
        managed.summary.error = msg
        managed.summary.endedAt = now()
        return
      }

      managed.child = child
      // Prevent unhandled EPIPE on closed child stdin from crashing the plugin host sidecar.
      child.stdin?.on('error', () => {})

      if (child.pid) {
        managed.summary.pid = child.pid
        if (
          managed.summary.attach &&
          (managed.summary.attach.kind === 'netcoredbg-server' || managed.summary.attach.kind === 'dotnet-pid')
        ) {
          const preferredEditor: EditorKind = getEditors().includes('codium') ? 'codium' : 'code'
          managed.summary.attach = {
            ...managed.summary.attach,
            pid: child.pid,
            attachJson: buildNetCoreDbgAttachSnippet({
              name: config.name,
              port: managed.summary.attach.port,
              pid: child.pid,
              editor: preferredEditor,
              stopAtEntry: config.stopOnEntry,
            }),
          }
        }
      }
      managed.summary.status = 'running'

      pipeStreamLines(child.stdout, (line) => appendLine(managed, 'stdout', line))
      pipeStreamLines(child.stderr, (line) => appendLine(managed, 'stderr', line))

      child.on('error', (err: NodeJS.ErrnoException) => {
        const friendly = err.code === 'ENOENT'
          ? `Runtime "${synth.command}" was not found on PATH (${err.message})`
          : err.message
        appendLine(managed, 'stderr', `Process error: ${friendly}`)
        managed.summary.status = managed.stopping ? 'stopped' : 'failed'
        managed.summary.error = friendly
        managed.summary.endedAt = now()
      })

      child.on('close', (code) => {
        managed.child = null
        if (managed.backgroundChild) {
          void killProcessTree(managed.backgroundChild)
          managed.backgroundChild = null
        }
        managed.summary.exitCode = code
        managed.summary.endedAt = now()
        if (managed.stopping) {
          managed.summary.status = 'stopped'
        } else if (code === 0 && managed.summary.status !== 'failed') {
          managed.summary.status = 'exited'
        } else {
          managed.summary.status = 'failed'
          if (!managed.summary.error) {
            managed.summary.error = `Exited with code ${code ?? 'signal'}`
          }
        }
        appendLine(managed, 'system', `[exit] Process exited (${code ?? 'terminated'})`)
        pruneTerminatedRuns()

        if (managed.stopAllPeers && managed.compoundGroupId && !managed.stopping) {
          for (const peer of runs.values()) {
            if (peer.compoundGroupId === managed.compoundGroupId && peer.summary.runId !== runId) {
              void stop([peer.summary.runId])
            }
          }
        }
      })
    })()

    return cloneSummary(summary)
  }

  async function start(request: StartLaunchRequest): Promise<LaunchRunSummary[]> {
    const discovered = discover(request.rootDir)
    const plan = resolveStartPlan(discovered, request, { now, baseEnv: deps.baseEnv })

    return Promise.all(
      plan.targets.map((cfg, idx) =>
        launchOne(discovered.rootDir, cfg, request.mode, {
          compoundGroupId: plan.compoundGroupId,
          stopAllPeers: plan.stopAllPeers,
          warningLines: idx === 0 ? plan.warnings : undefined,
          sharedPreTaskGate: plan.sharedPreTaskGate,
        }),
      ),
    )
  }

  async function stop(runIds: readonly string[]): Promise<string[]> {
    const expandedIds = new Set<string>(runIds)
    for (const id of runIds) {
      const target = runs.get(id)
      if (target?.stopAllPeers && target.compoundGroupId) {
        for (const peer of runs.values()) {
          if (peer.compoundGroupId === target.compoundGroupId) {
            expandedIds.add(peer.summary.runId)
          }
        }
      }
    }

    const stopped: string[] = []
    await Promise.all(
      Array.from(expandedIds).map(async (id) => {
        const managed = runs.get(id)
        if (!managed) return
        managed.stopping = true
        if (managed.child) {
          await killProcessTree(managed.child)
        }
        if (managed.backgroundChild) {
          await killProcessTree(managed.backgroundChild)
          managed.backgroundChild = null
        } else if (!managed.child && (managed.summary.status === 'starting' || managed.summary.status === 'running')) {
          managed.summary.status = 'stopped'
          managed.summary.endedAt = now()
        }
        stopped.push(id)
      }),
    )
    return stopped
  }

  async function stopInRoot(rootDir?: string): Promise<string[]> {
    const activeIds: string[] = []
    for (const managed of runs.values()) {
      const isLive = managed.summary.status === 'starting' || managed.summary.status === 'running'
      if (!isLive) continue
      if (!rootDir || managed.summary.rootDir === rootDir) {
        activeIds.push(managed.summary.runId)
      }
    }
    return stop(activeIds)
  }

  async function restart(runId: string, modeOverride?: LaunchRunMode): Promise<LaunchRunSummary> {
    const existing = runs.get(runId)
    if (!existing) throw new Error(`Unknown launch run "${runId}"`)
    await stop([runId])
    return launchOne(existing.summary.rootDir, existing.config, modeOverride ?? existing.summary.mode)
  }

  async function removeRun(runId: string): Promise<boolean> {
    await stop([runId])
    return runs.delete(runId)
  }

  function listRuns(): LaunchRunSummary[] {
    return Array.from(runs.values())
      .map((r) => cloneSummary(r.summary))
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  function readLogs(runId: string, afterSeq = 0): LaunchLogChunk {
    const managed = runs.get(runId)
    if (!managed) {
      return { runId, lines: [], nextSeq: afterSeq, truncated: false }
    }
    const firstAvailableSeq = managed.lines[0]?.seq ?? managed.nextSeq
    const truncated = managed.droppedLines > 0 && afterSeq < firstAvailableSeq - 1
    const lines = managed.lines.filter((l) => l.seq > afterSeq)
    return {
      runId,
      lines,
      nextSeq: managed.nextSeq - 1,
      truncated,
    }
  }

  function sendInput(runId: string, data: string): boolean {
    const managed = runs.get(runId)
    const stdin = managed?.child?.stdin
    if (!stdin || stdin.destroyed || stdin.writableEnded || !stdin.writable) return false
    stdin.write(data)
    return true
  }

  return {
    discover,
    start,
    stop,
    stopAll: () => stopInRoot(),
    stopInRoot,
    removeRun,
    restart,
    listRuns,
    readLogs,
    sendInput,
    getEditors,
  }
}
