import { invoke } from '@tauri-apps/api/core'

import type {
  AttachDescriptor,
  DiscoveredLaunchFile,
  DiscoveryResult,
  EditorKind,
  LaunchCompoundItem,
  LaunchConfigItem,
  LaunchLogChunk,
  LaunchLogLine,
  LaunchRunMode,
  LaunchRunStatus,
  LaunchRunSummary,
} from '../src/types'

export type PluginInvokeFn = (method: string, payload?: unknown) => Promise<unknown>

const VALID_STATUSES: readonly LaunchRunStatus[] = ['starting', 'running', 'exited', 'failed', 'stopped']
const VALID_MODES: readonly LaunchRunMode[] = ['run', 'debug']
const VALID_STREAMS: readonly LaunchLogLine['stream'][] = ['stdout', 'stderr', 'system']
const VALID_ATTACH_KINDS: readonly AttachDescriptor['kind'][] = [
  'netcoredbg-server',
  'dotnet-pid',
  'node-inspector',
  'debugpy',
  'dlv',
  'generic',
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function parseEditors(value: unknown): EditorKind[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is EditorKind => item === 'codium' || item === 'code')
}

function parseConfigItem(value: unknown): LaunchConfigItem | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.type !== 'string' ||
    typeof value.request !== 'string' ||
    typeof value.workspaceFolder !== 'string' ||
    typeof value.relativeFolder !== 'string'
  ) {
    return null
  }
  return {
    id: value.id,
    name: value.name,
    type: value.type,
    request: value.request,
    runnable: value.runnable === true || value.request === 'launch' || value.request === 'attach',
    workspaceFolder: value.workspaceFolder,
    relativeFolder: value.relativeFolder,
    ...(typeof value.preLaunchTask === 'string' ? { preLaunchTask: value.preLaunchTask } : {}),
    ...(typeof value.url === 'string' ? { url: value.url } : {}),
  }
}

function parseLaunchFile(value: unknown): DiscoveredLaunchFile | null {
  if (!isRecord(value)) return null
  if (
    typeof value.launchJsonPath !== 'string' ||
    typeof value.workspaceFolder !== 'string' ||
    typeof value.relativeFolder !== 'string'
  ) {
    return null
  }
  const configurations = Array.isArray(value.configurations)
    ? value.configurations.map(parseConfigItem).filter((c): c is LaunchConfigItem => c !== null)
    : []
  return {
    launchJsonPath: value.launchJsonPath,
    workspaceFolder: value.workspaceFolder,
    relativeFolder: value.relativeFolder,
    version: typeof value.version === 'string' ? value.version : '',
    configurations,
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
  }
}

function parseCompound(value: unknown): LaunchCompoundItem | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.relativeFolder !== 'string' ||
    typeof value.workspaceFolder !== 'string' ||
    !Array.isArray(value.configIds)
  ) {
    return null
  }
  return {
    id: value.id,
    name: value.name,
    relativeFolder: value.relativeFolder,
    workspaceFolder: value.workspaceFolder,
    configIds: value.configIds.filter((x): x is string => typeof x === 'string'),
    missingTargets: Array.isArray(value.missingTargets)
      ? value.missingTargets.filter((x): x is string => typeof x === 'string')
      : [],
    stopAll: value.stopAll === true,
    ...(typeof value.preLaunchTask === 'string' ? { preLaunchTask: value.preLaunchTask } : {}),
  }
}

function parseAttach(value: unknown): AttachDescriptor | undefined {
  if (!isRecord(value) || !VALID_ATTACH_KINDS.includes(value.kind as AttachDescriptor['kind'])) return undefined
  return {
    kind: value.kind as AttachDescriptor['kind'],
    ...(typeof value.host === 'string' ? { host: value.host } : {}),
    ...(typeof value.port === 'number' ? { port: value.port } : {}),
    ...(typeof value.pid === 'number' ? { pid: value.pid } : {}),
    ...(typeof value.wsUrl === 'string' ? { wsUrl: value.wsUrl } : {}),
    ...(typeof value.attachJson === 'string' ? { attachJson: value.attachJson } : {}),
    ...(typeof value.note === 'string' ? { note: value.note } : {}),
  }
}

function parseRunSummary(value: unknown): LaunchRunSummary | null {
  if (!isRecord(value)) return null
  if (
    typeof value.runId !== 'string' ||
    typeof value.configId !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.type !== 'string' ||
    !VALID_MODES.includes(value.mode as LaunchRunMode) ||
    !VALID_STATUSES.includes(value.status as LaunchRunStatus) ||
    typeof value.rootDir !== 'string' ||
    typeof value.workspaceFolder !== 'string' ||
    typeof value.relativeFolder !== 'string' ||
    typeof value.cwd !== 'string' ||
    typeof value.terminalCommand !== 'string' ||
    typeof value.startedAt !== 'number'
  ) {
    return null
  }
  const attach = parseAttach(value.attach)
  return {
    runId: value.runId,
    configId: value.configId,
    name: value.name,
    type: value.type,
    mode: value.mode as LaunchRunMode,
    status: value.status as LaunchRunStatus,
    rootDir: value.rootDir,
    workspaceFolder: value.workspaceFolder,
    relativeFolder: value.relativeFolder,
    cwd: value.cwd,
    terminalCommand: value.terminalCommand,
    startedAt: value.startedAt,
    listeningUrls: Array.isArray(value.listeningUrls)
      ? value.listeningUrls.filter((u): u is string => typeof u === 'string')
      : [],
    ...(typeof value.pid === 'number' ? { pid: value.pid } : {}),
    ...(typeof value.exitCode === 'number' || value.exitCode === null ? { exitCode: value.exitCode } : {}),
    ...(typeof value.endedAt === 'number' ? { endedAt: value.endedAt } : {}),
    ...(attach ? { attach } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
  }
}

function parseLogChunk(value: unknown, fallbackRunId: string, fallbackSeq: number): LaunchLogChunk {
  if (!isRecord(value)) {
    return { runId: fallbackRunId, lines: [], nextSeq: fallbackSeq, truncated: false }
  }
  const lines: LaunchLogLine[] = Array.isArray(value.lines)
    ? value.lines.flatMap((item): LaunchLogLine[] => {
        if (!isRecord(item)) return []
        if (
          typeof item.seq !== 'number' ||
          typeof item.text !== 'string' ||
          typeof item.timestamp !== 'number' ||
          !VALID_STREAMS.includes(item.stream as LaunchLogLine['stream'])
        ) {
          return []
        }
        return [{
          seq: item.seq,
          stream: item.stream as LaunchLogLine['stream'],
          text: item.text,
          timestamp: item.timestamp,
        }]
      })
    : []

  return {
    runId: typeof value.runId === 'string' ? value.runId : fallbackRunId,
    lines,
    nextSeq: typeof value.nextSeq === 'number' ? value.nextSeq : fallbackSeq,
    truncated: value.truncated === true,
  }
}

export interface VsCodeLaunchAPI {
  info(): Promise<{ available: boolean; editors: EditorKind[] }>
  discover(rootDir: string): Promise<DiscoveryResult>
  start(params: {
    rootDir: string
    configIds?: readonly string[]
    compoundId?: string
    mode: LaunchRunMode
  }): Promise<LaunchRunSummary[]>
  stop(runIds: readonly string[]): Promise<string[]>
  stopInRoot(rootDir: string): Promise<string[]>
  removeRun(runId: string): Promise<boolean>
  restart(runId: string, mode?: LaunchRunMode): Promise<LaunchRunSummary | null>
  listRuns(): Promise<LaunchRunSummary[]>
  readLogs(runId: string, afterSeq: number): Promise<LaunchLogChunk>
  sendInput(runId: string, data: string): Promise<boolean>
  openInEditor(folderPath: string, editor?: EditorKind): Promise<{ ok: boolean; editor?: EditorKind; message?: string }>
  openUrl(url: string): Promise<boolean>
}

const defaultInvoke: PluginInvokeFn = (method, payload) =>
  invoke<unknown>('plugin_invoke', { method, args: payload === undefined ? [] : [payload] })

export function createVsCodeLaunchAPI(invokeFn: PluginInvokeFn = defaultInvoke): VsCodeLaunchAPI {
  return {
    info: () =>
      invokeFn('vscodeLaunch.info').then(
        (res) => (isRecord(res) ? { available: true, editors: parseEditors(res.editors) } : { available: false, editors: [] }),
        () => ({ available: false, editors: [] }),
      ),

    discover: (rootDir) =>
      invokeFn('vscodeLaunch.discover', rootDir).then(
        (res): DiscoveryResult => {
          if (!isRecord(res)) return { rootDir, files: [], compounds: [], editors: [] }
          return {
            rootDir: typeof res.rootDir === 'string' ? res.rootDir : rootDir,
            files: Array.isArray(res.files)
              ? res.files.map(parseLaunchFile).filter((f): f is DiscoveredLaunchFile => f !== null)
              : [],
            compounds: Array.isArray(res.compounds)
              ? res.compounds.map(parseCompound).filter((c): c is LaunchCompoundItem => c !== null)
              : [],
            editors: parseEditors(res.editors),
          }
        },
        () => ({ rootDir, files: [], compounds: [], editors: [] }),
      ),

    start: (params) =>
      invokeFn('vscodeLaunch.start', params).then((res) =>
        Array.isArray(res) ? res.map(parseRunSummary).filter((r): r is LaunchRunSummary => r !== null) : [],
      ),

    stop: (runIds) =>
      invokeFn('vscodeLaunch.stop', { runIds }).then(
        (res) =>
          isRecord(res) && Array.isArray(res.stopped)
            ? res.stopped.filter((id): id is string => typeof id === 'string')
            : [],
        () => [],
      ),

    stopInRoot: (rootDir) =>
      invokeFn('vscodeLaunch.stop', { allInRoot: rootDir }).then(
        (res) =>
          isRecord(res) && Array.isArray(res.stopped)
            ? res.stopped.filter((id): id is string => typeof id === 'string')
            : [],
        () => [],
      ),

    removeRun: (runId) =>
      invokeFn('vscodeLaunch.removeRun', { runId }).then(
        (res) => isRecord(res) && res.ok === true,
        () => false,
      ),

    restart: (runId, mode) =>
      invokeFn('vscodeLaunch.restart', { runId, ...(mode ? { mode } : {}) }).then(
        (res) => parseRunSummary(res),
        () => null,
      ),

    listRuns: () =>
      invokeFn('vscodeLaunch.listRuns').then(
        (res) => (Array.isArray(res) ? res.map(parseRunSummary).filter((r): r is LaunchRunSummary => r !== null) : []),
        () => [],
      ),

    readLogs: (runId, afterSeq) =>
      invokeFn('vscodeLaunch.readLogs', { runId, afterSeq }).then(
        (res) => parseLogChunk(res, runId, afterSeq),
        () => ({ runId, lines: [], nextSeq: afterSeq, truncated: false }),
      ),

    sendInput: (runId, data) =>
      invokeFn('vscodeLaunch.sendInput', { runId, data }).then(
        (res) => isRecord(res) && res.ok === true,
        () => false,
      ),

    openInEditor: (folderPath, editor) =>
      invokeFn('vscodeLaunch.openInEditor', { folderPath, ...(editor ? { editor } : {}) }).then(
        (res) =>
          isRecord(res)
            ? {
                ok: res.ok === true,
                ...(res.editor === 'codium' || res.editor === 'code' ? { editor: res.editor } : {}),
                ...(typeof res.message === 'string' ? { message: res.message } : {}),
              }
            : { ok: false, message: 'No answer from plugin.' },
        (err: unknown) => ({ ok: false, message: err instanceof Error ? err.message : String(err) }),
      ),

    openUrl: (url) =>
      invokeFn('vscodeLaunch.openUrl', { url }).then(
        (res) => isRecord(res) && res.ok === true,
        () => false,
      ),
  }
}
